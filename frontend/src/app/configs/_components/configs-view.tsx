// CRITICAL
import {
  Activity,
  Check,
  Database,
  Eye,
  EyeOff,
  FolderOpen,
  Globe,
  Key,
  Link,
  Loader2,
  RefreshCw,
  Server,
  Settings,
  X,
} from "lucide-react";
import type { ConfigData, ServiceInfo } from "@/lib/types";
import { getStatusBg, getStatusColor } from "@/lib/colors";
import { ConfigRow } from "@/components/shared";
import type { ApiConnectionSettings, ConnectionStatus } from "../hooks/use-configs";

interface ConfigsViewProps {
  data: ConfigData | null;
  loading: boolean;
  error: string | null;
  apiSettings: ApiConnectionSettings;
  apiSettingsLoading: boolean;
  showApiKey: boolean;
  saving: boolean;
  testing: boolean;
  connectionStatus: ConnectionStatus;
  statusMessage: string;
  hasConfigData: boolean;
  isInitialLoading: boolean;
  onReload: () => void;
  onApiSettingsChange: (nextSettings: ApiConnectionSettings) => void;
  onToggleApiKey: () => void;
  onTestConnection: () => void;
  onSaveSettings: () => void;
}

export function ConfigsView({
  data,
  loading,
  error,
  apiSettings,
  apiSettingsLoading,
  showApiKey,
  saving,
  testing,
  connectionStatus,
  statusMessage,
  hasConfigData,
  isInitialLoading,
  onReload,
  onApiSettingsChange,
  onToggleApiKey,
  onTestConnection,
  onSaveSettings,
}: ConfigsViewProps) {
  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-[#1b1b1b] text-[#f0ebe3]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-6 w-full">
        <ConfigsHeader loading={loading} onReload={onReload} />

        <ApiConnectionSection
          apiSettingsLoading={apiSettingsLoading}
          apiSettings={apiSettings}
          showApiKey={showApiKey}
          testing={testing}
          saving={saving}
          connectionStatus={connectionStatus}
          statusMessage={statusMessage}
          onApiSettingsChange={onApiSettingsChange}
          onToggleApiKey={onToggleApiKey}
          onTestConnection={onTestConnection}
          onSave={onSaveSettings}
        />

        {!hasConfigData && (
          <NoBackendState
            error={error}
            isInitialLoading={isInitialLoading}
            loading={loading}
            onRetry={onReload}
          />
        )}

        {data && (
          <div className="grid lg:grid-cols-3 gap-6 sm:gap-8">
            <div className="lg:col-span-2 space-y-6">
              <ServiceTopology services={data.services} />
              <ConnectionFlow />
            </div>
            <ConfigCards data={data} />
          </div>
        )}
      </div>
    </div>
  );
}

function ConfigsHeader({ loading, onReload }: { loading: boolean; onReload: () => void }) {
  return (
    <div className="flex items-center justify-between mb-6 sm:mb-8">
      <div className="flex items-center gap-3">
        <Settings className="h-5 w-5 text-(--accent-purple)" />
        <h1 className="text-lg font-medium">System Configuration</h1>
      </div>
      <button
        onClick={onReload}
        disabled={loading}
        className="p-2 hover:bg-[#363432] rounded-lg transition-colors"
      >
        <RefreshCw className={`h-4 w-4 text-[#9a9088] ${loading ? "animate-spin" : ""}`} />
      </button>
    </div>
  );
}

function ApiConnectionSection({
  apiSettingsLoading,
  apiSettings,
  showApiKey,
  testing,
  saving,
  connectionStatus,
  statusMessage,
  onApiSettingsChange,
  onToggleApiKey,
  onTestConnection,
  onSave,
}: {
  apiSettingsLoading: boolean;
  apiSettings: ApiConnectionSettings;
  showApiKey: boolean;
  testing: boolean;
  saving: boolean;
  connectionStatus: ConnectionStatus;
  statusMessage: string;
  onApiSettingsChange: (nextSettings: ApiConnectionSettings) => void;
  onToggleApiKey: () => void;
  onTestConnection: () => void;
  onSave: () => void;
}) {
  return (
    <div className="mb-6 sm:mb-8">
      <div className="text-xs text-[#9a9088] uppercase tracking-wider mb-3">API Connection</div>
      <div className="bg-[#1e1e1e] rounded-lg p-4 sm:p-6">
        {apiSettingsLoading ? (
          <div className="flex items-center justify-center py-4">
            <Activity className="h-5 w-5 text-[#9a9088] animate-pulse" />
          </div>
        ) : (
          <div className="space-y-4">
            <ApiField
              label="API URL"
              value={apiSettings.backendUrl}
              placeholder="https://api.example.com"
              onChange={(backendUrl) => onApiSettingsChange({ ...apiSettings, backendUrl })}
            />

            <ApiKeyField
              apiKey={apiSettings.apiKey}
              hasApiKey={apiSettings.hasApiKey}
              showApiKey={showApiKey}
              onToggle={onToggleApiKey}
              onChange={(apiKey) => onApiSettingsChange({ ...apiSettings, apiKey })}
            />

            <ApiField
              label="Voice URL"
              value={apiSettings.voiceUrl}
              placeholder="https://voice.example.com"
              onChange={(voiceUrl) => onApiSettingsChange({ ...apiSettings, voiceUrl })}
            />

            <ApiField
              label="Voice Model"
              value={apiSettings.voiceModel}
              placeholder="whisper-large-v3-turbo"
              onChange={(voiceModel) => onApiSettingsChange({ ...apiSettings, voiceModel })}
            />

            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={onTestConnection}
                  disabled={testing}
                  className="px-3 py-1.5 bg-[#363432] rounded-lg text-xs text-[#f0ebe3] hover:bg-[#4a4846] disabled:opacity-50 flex items-center gap-1.5"
                >
                  {testing ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Link className="h-3 w-3" />
                  )}
                  Test
                </button>
                <button
                  onClick={onSave}
                  disabled={saving}
                  className="px-3 py-1.5 bg-(--accent-purple) rounded-lg text-xs text-[#f0ebe3] hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {saving ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Check className="h-3 w-3" />
                  )}
                  Save
                </button>
              </div>
              {statusMessage && <ApiStatus status={connectionStatus} message={statusMessage} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ApiField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="block text-xs text-[#9a9088] mb-1.5">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 bg-[#1b1b1b] border border-[#363432] rounded-lg text-sm text-[#f0ebe3] placeholder-[#9a9088]/50 focus:outline-none focus:border-(--accent-purple)"
      />
    </div>
  );
}

function ApiKeyField({
  apiKey,
  hasApiKey,
  showApiKey,
  onToggle,
  onChange,
}: {
  apiKey: string;
  hasApiKey: boolean;
  showApiKey: boolean;
  onToggle: () => void;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="block text-xs text-[#9a9088] mb-1.5">API Key</label>
      <div className="relative">
        <input
          type={showApiKey ? "text" : "password"}
          value={apiKey}
          onChange={(event) => onChange(event.target.value)}
          placeholder={hasApiKey ? "••••••••" : "Optional"}
          className="w-full px-3 py-2 pr-10 bg-[#1b1b1b] border border-[#363432] rounded-lg text-sm text-[#f0ebe3] placeholder-[#9a9088]/50 focus:outline-none focus:border-(--accent-purple)"
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#9a9088] hover:text-[#f0ebe3]"
        >
          {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function ApiStatus({
  status,
  message,
}: {
  status: ConnectionStatus;
  message: string;
}) {
  return (
    <div
      className={`flex items-center gap-1.5 text-xs ${
        status === "connected"
          ? "text-[#7d9a6a]"
          : status === "error"
            ? "text-[#c97a6b]"
            : "text-[#9a9088]"
      }`}
    >
      {status === "connected" && <div className="w-2 h-2 rounded-full bg-[#7d9a6a]" />}
      {status === "error" && <X className="h-3 w-3" />}
      {message}
    </div>
  );
}

function NoBackendState({
  error,
  isInitialLoading,
  loading,
  onRetry,
}: {
  error: string | null;
  isInitialLoading: boolean;
  loading: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="mb-6 sm:mb-8">
      <div className="bg-[#1e1e1e] rounded-lg p-4 sm:p-6 border border-[#363432]">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-[#f0ebe3]">
              {isInitialLoading ? (
                <Activity className="h-4 w-4 text-[#9a9088] animate-pulse" />
              ) : (
                <Server className="h-4 w-4 text-[#c9a66b]" />
              )}
              <span>{isInitialLoading ? "Checking controller connection…" : "No backend detected"}</span>
            </div>
            <p className="text-xs text-[#9a9088]">
              Configure the API connection above and click Test or Retry to load system details.
            </p>
            {error && !isInitialLoading && (
              <p className="text-[10px] text-[#c97a6b]">Last error: {error}</p>
            )}
          </div>
          <button
            onClick={onRetry}
            disabled={loading}
            className="px-3 py-1.5 bg-[#363432] rounded-lg text-xs text-[#f0ebe3] hover:bg-[#4a4846] disabled:opacity-50"
          >
            Retry
          </button>
        </div>
      </div>
    </div>
  );
}

function ServiceTopology({ services }: { services: ServiceInfo[] }) {
  return (
    <div>
      <div className="text-xs text-[#9a9088] uppercase tracking-wider mb-3">Service Topology</div>
      <div className="sm:hidden space-y-2">
        {services.map((service) => (
          <ServiceCard key={service.name} service={service} />
        ))}
      </div>
      <div className="hidden sm:block bg-[#1e1e1e] rounded-lg overflow-hidden">
        <ServiceTable services={services} />
      </div>
    </div>
  );
}

function ServiceCard({ service }: { service: ServiceInfo }) {
  return (
    <div className="bg-[#1e1e1e] rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${getStatusBg(service.status)}`} />
          <span className="text-[#f0ebe3] font-medium">{service.name}</span>
        </div>
        <span className={`text-xs ${getStatusColor(service.status)}`}>{service.status}</span>
      </div>
      <div className="space-y-1 text-xs text-[#9a9088]">
        <div className="flex justify-between">
          <span>Port</span>
          <span className="text-[#f0ebe3]">{service.port}</span>
        </div>
        {service.port !== service.internal_port && (
          <div className="flex justify-between">
            <span>Internal</span>
            <span className="text-[#f0ebe3]">{service.internal_port}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>Protocol</span>
          <span className="text-[#f0ebe3] uppercase">{service.protocol}</span>
        </div>
        {service.description && <div className="pt-1 text-[#9a9088]/70">{service.description}</div>}
      </div>
    </div>
  );
}

function ServiceTable({ services }: { services: ServiceInfo[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-[#9a9088] text-xs border-b border-[#363432]">
          <th className="text-left py-3 px-4 font-normal">Service</th>
          <th className="text-left py-3 px-4 font-normal">Port</th>
          <th className="text-left py-3 px-4 font-normal">Protocol</th>
          <th className="text-left py-3 px-4 font-normal">Status</th>
        </tr>
      </thead>
      <tbody>
        {services.map((service, index) => (
          <tr key={service.name} className={index > 0 ? "border-t border-[#363432]/50" : ""}>
            <td className="py-3 px-4">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${getStatusBg(service.status)}`} />
                <div>
                  <div className="text-[#f0ebe3]">{service.name}</div>
                  {service.description && (
                    <div className="text-[10px] text-[#9a9088]">{service.description}</div>
                  )}
                </div>
              </div>
            </td>
            <td className="py-3 px-4 text-[#f0ebe3]">
              {service.port}
              {service.port !== service.internal_port && (
                <span className="text-[#9a9088] text-xs ml-1">→ {service.internal_port}</span>
              )}
            </td>
            <td className="py-3 px-4">
              <span className="px-2 py-0.5 rounded bg-[#363432] text-[#f0ebe3] text-xs uppercase">
                {service.protocol}
              </span>
            </td>
            <td className="py-3 px-4">
              <span className={`text-sm ${getStatusColor(service.status)}`}>{service.status}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ConnectionFlow() {
  const flowItems = [
    { name: "Client", port: "3000", color: "bg-[#363432]" },
    { name: "UI", port: "8080", color: "bg-(--accent-purple)" },
    { name: "API", port: "4100", color: "bg-(--accent-purple)" },
    { name: "LiteLLM", port: "8000", color: "bg-(--accent-purple)" },
    { name: "vLLM", port: "", color: "bg-(--accent-purple)" },
  ];

  return (
    <div>
      <div className="text-xs text-[#9a9088] uppercase tracking-wider mb-3">Connection Flow</div>
      <div className="bg-[#1e1e1e] rounded-lg p-4 sm:p-6">
        <div className="sm:hidden space-y-3">
          {flowItems.map((item, index) => (
            <div key={item.name} className="flex items-center gap-3">
              <div
                className={`w-12 h-12 rounded-lg ${item.color} flex items-center justify-center text-[#f0ebe3] text-xs font-medium`}
              >
                {item.name}
              </div>
              {index < flowItems.length - 1 && (
                <>
                  <div className="flex-1 h-0.5 bg-[#363432]" />
                  <span className="text-[10px] text-[#9a9088]">:{item.port}</span>
                  <div className="text-[#9a9088]">→</div>
                </>
              )}
            </div>
          ))}
        </div>
        <div className="hidden sm:flex items-center justify-between text-sm">
          <div className="flex flex-col items-center gap-2">
            <div className="w-16 h-16 rounded-lg bg-[#363432] flex items-center justify-center text-[#f0ebe3] font-medium">
              Client
            </div>
          </div>
          <div className="flex-1 flex items-center gap-1 px-2">
            <div className="h-0.5 flex-1 bg-[#363432]" />
            <span className="text-[#9a9088] text-xs px-1">:3000</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className="w-16 h-16 rounded-lg bg-(--accent-purple) flex items-center justify-center text-[#f0ebe3] font-medium">
              UI
            </div>
          </div>
          <div className="flex-1 flex items-center gap-1 px-2">
            <div className="h-0.5 flex-1 bg-[#363432]" />
            <span className="text-[#9a9088] text-xs px-1">:8080</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className="w-16 h-16 rounded-lg bg-(--accent-purple) flex items-center justify-center text-[#f0ebe3] font-medium">
              API
            </div>
          </div>
          <div className="flex-1 flex items-center gap-1 px-2">
            <div className="h-0.5 flex-1 bg-[#363432]" />
            <span className="text-[#9a9088] text-xs px-1">:4100</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className="w-16 h-16 rounded-lg bg-(--accent-purple) flex items-center justify-center text-[#f0ebe3] font-medium">
              LLM
            </div>
          </div>
          <div className="flex-1 flex items-center gap-1 px-2">
            <div className="h-0.5 flex-1 bg-[#363432]" />
            <span className="text-[#9a9088] text-xs px-1">:8000</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className="w-16 h-16 rounded-lg bg-(--accent-purple) flex items-center justify-center text-[#f0ebe3] font-medium">
              vLLM
            </div>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-[#363432] text-[10px] sm:text-xs text-[#9a9088] text-center">
          Client → Frontend → Controller → LiteLLM → Inference Backend
        </div>
      </div>
    </div>
  );
}

function ConfigCards({ data }: { data: ConfigData }) {
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
      <div className="text-xs text-[#9a9088] uppercase tracking-wider mb-3">{title}</div>
      <div className="bg-[#1e1e1e] rounded-lg p-3 sm:p-4 space-y-3">{children}</div>
    </div>
  );
}
