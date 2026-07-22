from collections.abc import Mapping

from torch import nn
from vllm.model_executor.models.kimi_k25 import (
    KimiK25DummyInputsBuilder,
    KimiK25ForConditionalGeneration,
    KimiK25MultiModalProcessor,
    KimiK25ProcessingInfo,
)
from vllm.model_executor.models.kimi_k25_vit import (
    KimiK25MultiModalProjector,
    MoonViT3dPretrainedModel,
)
from vllm.model_executor.models.utils import (
    WeightsMapper,
    init_vllm_registered_model,
    maybe_prefix,
)
from vllm.multimodal import MULTIMODAL_REGISTRY
from vllm.multimodal.processing import BaseProcessingInfo, InputProcessingContext
from vllm.platforms import current_platform
from vllm.transformers_utils.processor import cached_get_image_processor
from vllm.transformers_utils.processors.kimi_k25 import KimiK25Processor


class Glm5vProcessingInfo(KimiK25ProcessingInfo):
    def __init__(self, ctx: InputProcessingContext) -> None:
        BaseProcessingInfo.__init__(self, ctx)
        self.hf_config = self.get_hf_config()
        tokenizer = self.get_tokenizer()
        image_processor = cached_get_image_processor(
            self.ctx.model_config.model,
            revision=self.ctx.model_config.revision,
            trust_remote_code=self.ctx.model_config.trust_remote_code,
        )
        media_token_id = tokenizer.convert_tokens_to_ids("<|image|>")
        if not isinstance(media_token_id, int):
            raise ValueError("GLM image token is unavailable")
        self.hf_config.media_placeholder_token_id = media_token_id
        self.media_token_id = media_token_id
        self.media_token = "<|image|>"
        self.image_processor = image_processor
        self.hf_processor = KimiK25Processor(
            tokenizer=tokenizer,
            image_processor=image_processor,
            media_token_id=media_token_id,
        )
        self.media_tokens_calculator = image_processor.media_tokens_calculator

    def get_hf_config(self):
        return self.ctx.get_hf_config()

    def get_supported_mm_limits(self) -> Mapping[str, int | None]:
        return {"vision_chunk": None}


class Glm5vDummyInputsBuilder(KimiK25DummyInputsBuilder):
    pass


class Glm5vMultiModalProcessor(KimiK25MultiModalProcessor):
    pass


@MULTIMODAL_REGISTRY.register_processor(
    Glm5vMultiModalProcessor,
    info=Glm5vProcessingInfo,
    dummy_inputs=Glm5vDummyInputsBuilder,
)
class Glm5vForConditionalGeneration(KimiK25ForConditionalGeneration):
    supports_encoder_tp_data = True

    hf_to_vllm_mapper = WeightsMapper(
        orig_to_new_prefix={
            "model.": "language_model.model.",
            "lm_head.": "language_model.lm_head.",
            "mm_projector.proj.0": "mm_projector.linear_1",
            "mm_projector.proj.2": "mm_projector.linear_2",
        }
    )

    @classmethod
    def get_placeholder_str(cls, modality: str, i: int) -> str | None:
        if modality == "image":
            return "<|begin_of_image|><|image|><|end_of_image|>"
        if modality == "video":
            return "<|glm5v_video_placeholder|>"
        raise ValueError(f"Unsupported modality: {modality}")

    def __init__(self, vllm_config, prefix: str = "") -> None:
        nn.Module.__init__(self)
        model_config = vllm_config.model_config
        config = model_config.hf_config
        self.config = config
        self.quant_config = vllm_config.quant_config
        self.use_data_parallel = (
            model_config.multimodal_config.mm_encoder_tp_mode == "data"
        )
        self.hidden_size = config.text_config.hidden_size
        self.device = current_platform.current_device()
        config.vision_config.mm_hidden_size = self.hidden_size
        config.vision_config.text_hidden_size = self.hidden_size
        with self._mark_tower_model(vllm_config, "vision_chunk"):
            self.vision_tower = MoonViT3dPretrainedModel(
                config.vision_config,
                quant_config=None,
                prefix="vision_tower",
            ).to(device=self.device, dtype=model_config.dtype)
            self.mm_projector = KimiK25MultiModalProjector(
                config=config.vision_config,
                use_data_parallel=self.use_data_parallel,
                quant_config=None,
                prefix="mm_projector",
            ).to(device=self.device, dtype=model_config.dtype)
        with self._mark_language_model(vllm_config):
            self.language_model = init_vllm_registered_model(
                vllm_config=vllm_config,
                hf_config=config.text_config,
                prefix=maybe_prefix(prefix, "language_model"),
                architectures=["GlmMoeDsaForCausalLM"],
            )
        self.make_empty_intermediate_tensors = (
            self.language_model.make_empty_intermediate_tensors
        )
        self.media_placeholder = config.media_placeholder_token_id
