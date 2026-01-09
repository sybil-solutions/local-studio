'use client';

import { useState, useEffect } from 'react';
import { Settings, Activity, Server, Database, Globe, FolderOpen, Key, RefreshCw } from 'lucide-react';
import api from '@/lib/api';

interface ServiceInfo {
  name: string;
  port: number;
  internal_port: number;
  protocol: string;
  status: string;
  description: string | null;
}

interface SystemConfig {
  host: string;
  port: number;
  inference_port: number;
  api_key_configured: boolean;
  models_dir: string;
  data_dir: string;
  db_path: string;
  sglang_python: string | null;
  tabby_api_dir: string | null;
}

interface EnvironmentInfo {
  controller_url: string;
  inference_url: string;
  litellm_url: string;
  frontend_url: string;
}

interface ConfigData {
  config: SystemConfig;
  services: ServiceInfo[];
  environment: EnvironmentInfo;
}

function getStatusColor(status: string): string {
  switch (status.toLowerCase()) {
    case 'running':
      return 'text-[#7d9a6a]';
    case 'stopped':
      return 'text-[#363432]';
    case 'error':
      return 'text-[#c97a6b]';
    case 'degraded':
      return 'text-[#c9a66b]';
    default:
      return 'text-[#c9a66b]';
  }
}

function getStatusBg(status: string): string {
  switch (status.toLowerCase()) {
    case 'running':
      return 'bg-[#7d9a6a]';
    case 'stopped':
      return 'bg-[#363432]';
    case 'error':
      return 'bg-[#c97a6b]';
    case 'degraded':
      return 'bg-[#c9a66b]';
    default:
      return 'bg-[#c9a66b]';
  }
}

export default function ConfigsPage() {
  const [data, setData] = useState<ConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadConfig = async () => {
    try {
      setLoading(true);
      setError(null);
      const configData = await api.getSystemConfig();
      setData(configData);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#1b1b1b]">
        <Activity className="h-5 w-5 text-[#9a9088] animate-pulse" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#1b1b1b]">
        <div className="text-center">
          <p className="text-[#c97a6b] mb-4">{error}</p>
          <button
            onClick={loadConfig}
            className="px-4 py-2 bg-[#363432] rounded-lg text-[#f0ebe3] hover:bg-[#4a4846]"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#1b1b1b] text-[#f0ebe3]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-6 pb-[calc(1rem+env(safe-area-inset-bottom))]">

        {/* Header */}
        <div className="flex items-center justify-between mb-6 sm:mb-8">
          <div className="flex items-center gap-3">
            <Settings className="h-5 w-5 text-[#8b7355]" />
            <h1 className="text-lg font-medium">System Configuration</h1>
          </div>
          <button
            onClick={loadConfig}
            disabled={loading}
            className="p-2 hover:bg-[#363432] rounded-lg transition-colors"
          >
            <RefreshCw className={`h-4 w-4 text-[#9a9088] ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {data && (
          <div className="grid lg:grid-cols-3 gap-6 sm:gap-8">

            {/* Left Column - Service Topology */}
            <div className="lg:col-span-2 space-y-6">

              {/* Services Grid */}
              <div>
                <div className="text-xs text-[#9a9088] uppercase tracking-wider mb-3">Service Topology</div>

                {/* Mobile: Card Layout */}
                <div className="sm:hidden space-y-2">
                  {data.services.map((service) => (
                    <div key={service.name} className="bg-[#1e1e1e] rounded-lg p-4">
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
                        {service.description && (
                          <div className="pt-1 text-[#9a9088]/70">{service.description}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop: Table Layout */}
                <div className="hidden sm:block bg-[#1e1e1e] rounded-lg overflow-hidden">
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
                      {data.services.map((service, i) => (
                        <tr key={service.name} className={i > 0 ? 'border-t border-[#363432]/50' : ''}>
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
                </div>
              </div>

              {/* Connection Flow */}
              <div>
                <div className="text-xs text-[#9a9088] uppercase tracking-wider mb-3">Connection Flow</div>
                <div className="bg-[#1e1e1e] rounded-lg p-4 sm:p-6">
                  <div className="flex items-center justify-between text-xs sm:text-sm">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-lg bg-[#363432] flex items-center justify-center text-[#f0ebe3] font-medium">
                        Client
                      </div>
                    </div>
                    <div className="flex-1 flex items-center gap-1 px-2">
                      <div className="h-0.5 flex-1 bg-[#363432]" />
                      <span className="text-[#9a9088] text-[10px] sm:text-xs px-1">:3000</span>
                    </div>
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-lg bg-[#8b7355] flex items-center justify-center text-[#f0ebe3] font-medium">
                        UI
                      </div>
                    </div>
                    <div className="flex-1 flex items-center gap-1 px-2">
                      <div className="h-0.5 flex-1 bg-[#363432]" />
                      <span className="text-[#9a9088] text-[10px] sm:text-xs px-1">:8080</span>
                    </div>
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-lg bg-[#6b9ac9] flex items-center justify-center text-[#f0ebe3] font-medium">
                        API
                      </div>
                    </div>
                    <div className="flex-1 flex items-center gap-1 px-2">
                      <div className="h-0.5 flex-1 bg-[#363432]" />
                      <span className="text-[#9a9088] text-[10px] sm:text-xs px-1">:4100</span>
                    </div>
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-lg bg-[#7d9a6a] flex items-center justify-center text-[#f0ebe3] font-medium">
                        LLM
                      </div>
                    </div>
                    <div className="flex-1 flex items-center gap-1 px-2">
                      <div className="h-0.5 flex-1 bg-[#363432]" />
                      <span className="text-[#9a9088] text-[10px] sm:text-xs px-1">:8000</span>
                    </div>
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-lg bg-[#c9a66b] flex items-center justify-center text-[#f0ebe3] font-medium">
                        vLLM
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-[#363432] text-[10px] sm:text-xs text-[#9a9088] text-center">
                    Client → Frontend → Controller → LiteLLM → Inference Backend
                  </div>
                </div>
              </div>

            </div>

            {/* Right Column - Configuration */}
            <div className="space-y-6 sm:space-y-8">

              {/* Network Configuration */}
              <div>
                <div className="text-xs text-[#9a9088] uppercase tracking-wider mb-3">Network</div>
                <div className="bg-[#1e1e1e] rounded-lg p-3 sm:p-4 space-y-3">
                  <ConfigRow label="Host" value={data.config.host} icon={<Server className="h-3 w-3" />} />
                  <ConfigRow label="Controller Port" value={data.config.port.toString()} icon={<Server className="h-3 w-3" />} />
                  <ConfigRow label="Inference Port" value={data.config.inference_port.toString()} icon={<Server className="h-3 w-3" />} />
                  <ConfigRow
                    label="API Key"
                    value={data.config.api_key_configured ? 'Configured' : 'Not set'}
                    icon={<Key className="h-3 w-3" />}
                    accent={data.config.api_key_configured}
                  />
                </div>
              </div>

              {/* Storage Paths */}
              <div>
                <div className="text-xs text-[#9a9088] uppercase tracking-wider mb-3">Storage</div>
                <div className="bg-[#1e1e1e] rounded-lg p-3 sm:p-4 space-y-3">
                  <ConfigRow label="Models" value={data.config.models_dir} icon={<FolderOpen className="h-3 w-3" />} truncate />
                  <ConfigRow label="Data" value={data.config.data_dir} icon={<FolderOpen className="h-3 w-3" />} truncate />
                  <ConfigRow label="Database" value={data.config.db_path} icon={<Database className="h-3 w-3" />} truncate />
                </div>
              </div>

              {/* Backend Configuration */}
              <div>
                <div className="text-xs text-[#9a9088] uppercase tracking-wider mb-3">Backends</div>
                <div className="bg-[#1e1e1e] rounded-lg p-3 sm:p-4 space-y-3">
                  <ConfigRow
                    label="SGLang"
                    value={data.config.sglang_python || 'Not configured'}
                    icon={<Settings className="h-3 w-3" />}
                    truncate
                  />
                  <ConfigRow
                    label="TabbyAPI"
                    value={data.config.tabby_api_dir || 'Not configured'}
                    icon={<Settings className="h-3 w-3" />}
                    truncate
                  />
                </div>
              </div>

              {/* Environment URLs */}
              <div>
                <div className="text-xs text-[#9a9088] uppercase tracking-wider mb-3">Environment</div>
                <div className="bg-[#1e1e1e] rounded-lg p-3 sm:p-4 space-y-3">
                  <ConfigRow label="Controller" value={data.environment.controller_url} icon={<Globe className="h-3 w-3" />} truncate />
                  <ConfigRow label="Inference" value={data.environment.inference_url} icon={<Globe className="h-3 w-3" />} truncate />
                  <ConfigRow label="LiteLLM" value={data.environment.litellm_url} icon={<Globe className="h-3 w-3" />} truncate />
                  <ConfigRow label="Frontend" value={data.environment.frontend_url} icon={<Globe className="h-3 w-3" />} truncate />
                </div>
              </div>

            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ConfigRow({
  label,
  value,
  icon,
  truncate,
  accent
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  truncate?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="flex items-center gap-2 text-[#9a9088] text-sm min-w-0 flex-shrink-0">
        {icon}
        <span>{label}</span>
      </div>
      <span className={`text-xs sm:text-sm font-mono ${accent ? 'text-[#7d9a6a]' : 'text-[#f0ebe3]'} ${truncate ? 'truncate' : ''} text-right flex-1`}>
        {value}
      </span>
    </div>
  );
}
