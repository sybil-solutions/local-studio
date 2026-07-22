import argparse
import hashlib
import json
import os
import shutil
import struct
from pathlib import Path


REPLACED_FILES = {
    "chat_template.jinja",
    "config.json",
    "docker-compose.yml",
    "model.safetensors.index.json",
    "README.md",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(8 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def safetensors_header(path: Path) -> dict:
    with path.open("rb") as handle:
        header_size = struct.unpack("<Q", handle.read(8))[0]
        return json.loads(handle.read(header_size))


def verify_assets(assets: Path, manifest_path: Path) -> dict:
    manifest = json.loads(manifest_path.read_text())
    for name, expected in manifest["files"].items():
        path = assets / name
        if not path.is_file():
            raise FileNotFoundError(path)
        if expected.get("size") is not None and path.stat().st_size != expected["size"]:
            raise ValueError(f"Unexpected size for {path}")
        if sha256(path) != expected["sha256"]:
            raise ValueError(f"Unexpected hash for {path}")
    return manifest


def add_weight_file(index: dict, path: Path) -> tuple[int, int]:
    header = safetensors_header(path)
    parameters = 0
    payload_bytes = 0
    for name, tensor in header.items():
        if name == "__metadata__":
            continue
        index["weight_map"][name] = path.name
        tensor_parameters = 1
        for dimension in tensor["shape"]:
            tensor_parameters *= dimension
        parameters += tensor_parameters
        payload_bytes += tensor["data_offsets"][1] - tensor["data_offsets"][0]
    return parameters, payload_bytes


def build_config(source: Path, assets: Path) -> dict:
    source_config = json.loads((source / "config.json").read_text())
    baseten_config = json.loads((assets / "config.json").read_text())
    config = dict(baseten_config)
    config["architectures"] = ["Glm5vForConditionalGeneration"]
    config["auto_map"] = {"AutoConfig": "configuration_glm5v.Glm5vConfig"}
    config["model_type"] = "glm5v"
    config["text_config"] = source_config
    config["quantization_config"] = source_config["quantization_config"]
    config["vision_config"] = dict(baseten_config["vision_config"])
    config["vision_config"]["mm_hidden_size"] = source_config["hidden_size"]
    config["vision_config"]["text_hidden_size"] = source_config["hidden_size"]
    return config


def assemble(source: Path, target: Path, assets: Path, bundle: Path) -> None:
    if not source.is_dir():
        raise FileNotFoundError(source)
    if target.exists():
        raise FileExistsError(target)
    partial = target.with_name(f".{target.name}.partial-{os.getpid()}")
    if partial.exists():
        raise FileExistsError(partial)
    partial.mkdir(parents=True)
    try:
        for source_path in source.iterdir():
            if not source_path.is_file() or source_path.name in REPLACED_FILES:
                continue
            destination = partial / source_path.name
            if source_path.name.startswith("model-") and source_path.suffix == ".safetensors":
                os.link(source_path, destination)
            else:
                shutil.copy2(source_path, destination)
        for name in (
            "chat_template.jinja",
            "kimi_k25_processor.py",
            "kimi_k25_vision_processing.py",
            "media_utils.py",
            "preprocessor_config.json",
        ):
            shutil.copy2(assets / name, partial / name)
        for name in ("vision_tower.safetensors", "mm_projector.safetensors"):
            os.link(assets / name, partial / name)
        shutil.copy2(bundle / "configuration_glm5v.py", partial / "configuration_glm5v.py")
        config = build_config(source, assets)
        (partial / "config.json").write_text(json.dumps(config, indent=2) + "\n")
        index = json.loads((source / "model.safetensors.index.json").read_text())
        total_parameters = 0
        total_size = 0
        for name in ("vision_tower.safetensors", "mm_projector.safetensors"):
            parameters, payload_bytes = add_weight_file(index, partial / name)
            total_parameters += parameters
            total_size += payload_bytes
        metadata = index.setdefault("metadata", {})
        if "total_parameters" in metadata:
            metadata["total_parameters"] = int(metadata["total_parameters"]) + total_parameters
        metadata["total_size"] = int(metadata.get("total_size", 0)) + total_size
        (partial / "model.safetensors.index.json").write_text(
            json.dumps(index, indent=2, sort_keys=True) + "\n"
        )
        provenance = {
            "base_checkpoint": str(source),
            "base_config_sha256": sha256(source / "config.json"),
            "base_index_sha256": sha256(source / "model.safetensors.index.json"),
            "vision_repository": "baseten/GLM-5.2-Vision-NVFP4",
            "vision_revision": "f6eab6117386a0c69152fdf272dc65bfd0254f9f",
            "vision_parameters": total_parameters,
            "vision_payload_bytes": total_size,
        }
        (partial / "VISION_PROVENANCE.json").write_text(
            json.dumps(provenance, indent=2, sort_keys=True) + "\n"
        )
        partial.rename(target)
    except BaseException:
        shutil.rmtree(partial, ignore_errors=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--target", type=Path, required=True)
    parser.add_argument("--assets", type=Path, required=True)
    parser.add_argument("--bundle", type=Path, required=True)
    args = parser.parse_args()
    verify_assets(args.assets, args.bundle / "asset-manifest.json")
    assemble(args.source.resolve(), args.target.resolve(), args.assets.resolve(), args.bundle.resolve())


if __name__ == "__main__":
    main()
