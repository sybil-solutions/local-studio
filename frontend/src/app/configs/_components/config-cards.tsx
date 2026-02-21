// CRITICAL
import { Cpu, Database, FolderOpen, Globe, Key, Server, Settings } from "lucide-react";
import type { ConfigData } from "@/lib/types";
import { ConfigRow } from "@/components/shared";

export function ConfigCards({ data }: { data: ConfigData }) {
  const formatRuntime = (
    info?: ConfigData["runtime"]["backends"][keyof ConfigData["runtime"]["backends"]],
  ) => {
    if (!info?.installed) {
      return "Not installed";
    }
    return info.version ? info.version : "Installed";
  };

  const runtime = data.runtime;
  const platform = runtime?.platform;

  return (
    <div className="space-y-6 sm:space-y-8">
      <ConfigSection title="Network">
        <ConfigRow label="Host" value={data.config.host} icon={<Server className="h-3 w-3" />} />
        <ConfigRow
          label="Controller Port"
          value={data.config.port.toString()}
          icon={<Server className="h-3 w-3" />}
        />
        <ConfigRow
          label="Inference Port"
          value={data.config.inference_port.toString()}
          icon={<Server className="h-3 w-3" />}
        />
        <ConfigRow
          label="API Key"
          value={data.config.api_key_configured ? "Configured" : "Not set"}
          icon={<Key className="h-3 w-3" />}
          accent={data.config.api_key_configured}
        />
      </ConfigSection>

      <ConfigSection title="Storage">
        <ConfigRow
          label="Models"
          value={data.config.models_dir}
          icon={<FolderOpen className="h-3 w-3" />}
          truncate
        />
        <ConfigRow
          label="Data"
          value={data.config.data_dir}
          icon={<FolderOpen className="h-3 w-3" />}
          truncate
        />
        <ConfigRow
          label="Database"
          value={data.config.db_path}
          icon={<Database className="h-3 w-3" />}
          truncate
        />
      </ConfigSection>

      <ConfigSection title="Backends">
        <ConfigRow
          label="SGLang"
          value={data.config.sglang_python || "Not configured"}
          icon={<Settings className="h-3 w-3" />}
          truncate
        />
        <ConfigRow
          label="TabbyAPI"
          value={data.config.tabby_api_dir || "Not configured"}
          icon={<Settings className="h-3 w-3" />}
          truncate
        />
        <ConfigRow
          label="llama.cpp"
          value={data.config.llama_bin || "Not configured"}
          icon={<Settings className="h-3 w-3" />}
          truncate
        />
      </ConfigSection>

      <ConfigSection title="Runtime Versions">
        <ConfigRow
          label="vLLM"
          value={formatRuntime(runtime?.backends?.vllm)}
          icon={<Server className="h-3 w-3" />}
        />
        <ConfigRow
          label="SGLang"
          value={formatRuntime(runtime?.backends?.sglang)}
          icon={<Server className="h-3 w-3" />}
        />
        <ConfigRow
          label="llama.cpp"
          value={formatRuntime(runtime?.backends?.llamacpp)}
          icon={<Server className="h-3 w-3" />}
        />
      </ConfigSection>

      <ConfigSection title="Hardware">
        <ConfigRow
          label="Platform"
          value={platform?.kind || "Unknown"}
          icon={<Cpu className="h-3 w-3" />}
        />
        <ConfigRow
          label="GPU Monitoring"
          value={
            runtime?.gpu_monitoring?.available
              ? runtime.gpu_monitoring.tool || "available"
              : `unavailable (${runtime?.gpu_monitoring?.tool || "none"})`
          }
          icon={<Cpu className="h-3 w-3" />}
        />
        <ConfigRow
          label="GPU Count"
          value={runtime?.gpus?.count ? runtime.gpus.count.toString() : "None detected"}
          icon={<Cpu className="h-3 w-3" />}
        />
        <ConfigRow
          label="GPU Types"
          value={runtime?.gpus?.types?.length ? runtime.gpus.types.join(", ") : "Unknown"}
          icon={<Cpu className="h-3 w-3" />}
          truncate
        />
        <ConfigRow
          label="ROCm Version"
          value={platform?.rocm?.rocm_version || "Unknown"}
          icon={<Cpu className="h-3 w-3" />}
        />
        <ConfigRow
          label="HIP Version"
          value={platform?.rocm?.hip_version || "Unknown"}
          icon={<Cpu className="h-3 w-3" />}
        />
        <ConfigRow
          label="ROCm Arch"
          value={platform?.rocm?.gpu_arch?.join(", ") || "Unknown"}
          icon={<Cpu className="h-3 w-3" />}
          truncate
        />
        <ConfigRow
          label="CUDA Driver"
          value={runtime?.cuda?.driver_version || "Unknown"}
          icon={<Cpu className="h-3 w-3" />}
        />
        <ConfigRow
          label="CUDA Runtime"
          value={runtime?.cuda?.cuda_version || "Unknown"}
          icon={<Cpu className="h-3 w-3" />}
        />
      </ConfigSection>

      <ConfigSection title="Environment">
        <ConfigRow
          label="Controller"
          value={data.environment.controller_url}
          icon={<Globe className="h-3 w-3" />}
          truncate
        />
        <ConfigRow
          label="Inference"
          value={data.environment.inference_url}
          icon={<Globe className="h-3 w-3" />}
          truncate
        />
        <ConfigRow
          label="LiteLLM"
          value={data.environment.litellm_url}
          icon={<Globe className="h-3 w-3" />}
          truncate
        />
        <ConfigRow
          label="Frontend"
          value={data.environment.frontend_url}
          icon={<Globe className="h-3 w-3" />}
          truncate
        />
      </ConfigSection>
    </div>
  );
}

function ConfigSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-(--dim) uppercase tracking-wider mb-3">{title}</div>
      <div className="bg-(--surface) rounded-lg p-3 sm:p-4 space-y-3">{children}</div>
    </div>
  );
}
