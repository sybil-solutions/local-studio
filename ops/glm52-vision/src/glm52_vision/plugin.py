import copy


def _patch_speculative_config() -> None:
    from vllm.config.speculative import SpeculativeConfig

    current = SpeculativeConfig.hf_config_override
    if getattr(current, "_glm52_vision", False):
        return

    def override(hf_config):
        architectures = getattr(hf_config, "architectures", [])
        if "Glm5vForConditionalGeneration" in architectures:
            quantization_config = copy.deepcopy(
                getattr(hf_config, "quantization_config", None)
            )
            model_path = getattr(hf_config, "_name_or_path", None)
            hf_config = copy.deepcopy(hf_config.text_config)
            if quantization_config is not None:
                hf_config.quantization_config = quantization_config
            if model_path:
                hf_config._name_or_path = model_path
        return current(hf_config)

    override._glm52_vision = True
    SpeculativeConfig.hf_config_override = staticmethod(override)


def register() -> None:
    from vllm.model_executor.models.registry import ModelRegistry

    ModelRegistry.register_model(
        "Glm5vForConditionalGeneration",
        "glm52_vision.model:Glm5vForConditionalGeneration",
    )
    _patch_speculative_config()
