from transformers import AutoConfig
from transformers.configuration_utils import PretrainedConfig


class Glm5vVisionConfig(PretrainedConfig):
    model_type = "glm5v_vision"

    def __init__(
        self,
        patch_size: int = 14,
        init_pos_emb_height: int = 64,
        init_pos_emb_width: int = 64,
        init_pos_emb_time: int = 4,
        pos_emb_type: str = "divided_fixed",
        num_attention_heads: int = 16,
        num_hidden_layers: int = 27,
        hidden_size: int = 1152,
        intermediate_size: int = 4304,
        merge_kernel_size=(2, 2),
        video_attn_type: str = "spatial_temporal",
        merge_type: str = "sd2_tpool",
        mm_projector_type: str = "patchmerger",
        mm_hidden_size: int = 6144,
        vt_hidden_size: int | None = None,
        projector_hidden_act: str = "gelu",
        projector_ln_eps: float = 1e-5,
        text_hidden_size: int = 6144,
        **kwargs,
    ):
        super().__init__(**kwargs)
        self.patch_size = patch_size
        self.init_pos_emb_height = init_pos_emb_height
        self.init_pos_emb_width = init_pos_emb_width
        self.init_pos_emb_time = init_pos_emb_time
        self.pos_emb_type = pos_emb_type
        self.num_attention_heads = num_attention_heads
        self.num_hidden_layers = num_hidden_layers
        self.hidden_size = hidden_size
        self.intermediate_size = intermediate_size
        self.merge_kernel_size = merge_kernel_size
        self.video_attn_type = video_attn_type
        self.merge_type = merge_type
        self.mm_projector_type = mm_projector_type
        self.mm_hidden_size = mm_hidden_size
        self.vt_hidden_size = vt_hidden_size if vt_hidden_size is not None else hidden_size
        self.projector_hidden_act = projector_hidden_act
        self.projector_ln_eps = projector_ln_eps
        self.text_hidden_size = text_hidden_size

    def __getattr__(self, name):
        if name.startswith("vt_"):
            values = object.__getattribute__(self, "__dict__")
            base_name = name[3:]
            if base_name in values:
                return values[base_name]
        raise AttributeError(name)


class Glm5vConfig(PretrainedConfig):
    model_type = "glm5v"

    def __init__(
        self,
        text_config=None,
        vision_config=None,
        ignore_index: int = -100,
        media_placeholder_token_id: int = 154854,
        pad_token_id: int = 154820,
        use_unified_vision_chunk: bool = True,
        video_placeholder: str = "<|glm5v_video_placeholder|>",
        encoder_only: bool = False,
        language_only: bool = False,
        **kwargs,
    ):
        if vision_config is None:
            self.vision_config = Glm5vVisionConfig()
        elif isinstance(vision_config, dict):
            self.vision_config = Glm5vVisionConfig(**vision_config)
        else:
            self.vision_config = vision_config
        raw_text_config = dict(text_config) if isinstance(text_config, dict) else None
        if text_config is None:
            self.text_config = AutoConfig.for_model("glm_moe_dsa")
        elif isinstance(text_config, dict):
            normalized_text_config = dict(text_config)
            normalized_text_config.setdefault("model_type", "glm_moe_dsa")
            normalized_text_config.pop("layer_types", None)
            self.text_config = AutoConfig.for_model(**normalized_text_config)
        else:
            self.text_config = text_config
        if raw_text_config is not None:
            for key in ("qk_rope_head_dim", "index_topk_freq"):
                if key in raw_text_config:
                    setattr(self.text_config, key, raw_text_config[key])
            if hasattr(self.text_config, "qk_nope_head_dim") and hasattr(
                self.text_config,
                "qk_rope_head_dim",
            ):
                self.text_config.qk_head_dim = (
                    self.text_config.qk_nope_head_dim
                    + self.text_config.qk_rope_head_dim
                )
        self.ignore_index = ignore_index
        self.media_placeholder_token_id = media_placeholder_token_id
        self.use_unified_vision_chunk = use_unified_vision_chunk
        self.video_placeholder = video_placeholder
        self.encoder_only = encoder_only
        self.language_only = language_only
        if getattr(self.text_config, "quantization_config", None) is not None:
            self.quantization_config = self.text_config.quantization_config
        super().__init__(pad_token_id=pad_token_id, **kwargs)

    @property
    def hidden_size(self) -> int:
        return self.text_config.hidden_size

    @property
    def vocab_size(self) -> int:
        return self.text_config.vocab_size

