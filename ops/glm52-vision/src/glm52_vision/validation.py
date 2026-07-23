import copy
import json
import sys
from pathlib import Path

from PIL import Image
from transformers import AutoConfig, AutoImageProcessor, AutoTokenizer
from vllm.config.speculative import SpeculativeConfig
from vllm.model_executor.models.registry import ModelRegistry
from vllm.multimodal.inputs import VisionChunkImage
from vllm.plugins import load_general_plugins
from vllm.transformers_utils.processors.kimi_k25 import KimiK25Processor

from glm52_vision.plugin import text_config_with_attention_overrides


def main() -> None:
    model_path = Path(sys.argv[1]).resolve()
    load_general_plugins()
    config = AutoConfig.from_pretrained(model_path, trust_remote_code=True)
    if config.architectures != ["Glm5vForConditionalGeneration"]:
        raise ValueError(config.architectures)
    if config.text_config.hidden_size != 6144:
        raise ValueError(config.text_config.hidden_size)
    if config.vision_config.mm_hidden_size != 6144:
        raise ValueError(config.vision_config.mm_hidden_size)
    config.use_index_cache = True
    config.index_topk_pattern = "FFFSSS"
    text_config = text_config_with_attention_overrides(config)
    if text_config.use_index_cache is not True:
        raise ValueError(text_config.use_index_cache)
    if text_config.index_topk_pattern != "FFFSSS":
        raise ValueError(text_config.index_topk_pattern)
    if "Glm5vForConditionalGeneration" not in ModelRegistry.get_supported_archs():
        raise ValueError("GLM vision model registration failed")
    tokenizer = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)
    image_processor = AutoImageProcessor.from_pretrained(
        model_path,
        trust_remote_code=True,
    )
    media_token_id = tokenizer.convert_tokens_to_ids("<|image|>")
    processor = KimiK25Processor(
        tokenizer=tokenizer,
        image_processor=image_processor,
        media_token_id=media_token_id,
    )
    processed = processor(
        text="<|image|>",
        vision_chunks=[VisionChunkImage(type="image", image=Image.new("RGB", (28, 28)))],
        return_tensors="pt",
    )
    if processed["pixel_values"].numel() == 0:
        raise ValueError("Vision preprocessing returned no pixels")
    draft_config = SpeculativeConfig.hf_config_override(copy.deepcopy(config))
    if draft_config.architectures != ["DeepSeekMTPModel"]:
        raise ValueError(draft_config.architectures)
    index = json.loads((model_path / "model.safetensors.index.json").read_text())
    vision_entries = sum(
        name.startswith("vision_tower.") for name in index["weight_map"]
    )
    projector_entries = sum(
        name.startswith("mm_projector.") for name in index["weight_map"]
    )
    if vision_entries != 329 or projector_entries != 6:
        raise ValueError((vision_entries, projector_entries))
    print(
        json.dumps(
            {
                "architecture": config.architectures[0],
                "draft_architecture": draft_config.architectures[0],
                "image_token_id": media_token_id,
                "pixel_values_shape": list(processed["pixel_values"].shape),
                "grid_thws": processed["grid_thws"].tolist(),
                "index_topk_pattern": text_config.index_topk_pattern,
                "use_index_cache": text_config.use_index_cache,
                "vision_entries": vision_entries,
                "projector_entries": projector_entries,
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
