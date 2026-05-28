"use client";

import { Brain, MessageSquare, Wrench } from "lucide-react";
import type { RecipeEditor } from "@/lib/types";
import { LlamacppOptionsSection } from "../llamacpp-options-section";

export function RecipeModalTabFeatures({
  recipe,
  onChange,
  isLlamacpp,
  getExtraArgValueForKey,
  setExtraArgValueForKey,
}: {
  recipe: RecipeEditor;
  onChange: (next: RecipeEditor) => void;
  isLlamacpp: boolean;
  getExtraArgValueForKey: (key: string) => unknown;
  setExtraArgValueForKey: (key: string, value: unknown) => void;
}) {
  if (isLlamacpp) {
    return (
      <div className="space-y-5">
        <LlamacppOptionsSection
          tab="features"
          getValueForKey={getExtraArgValueForKey}
          setValueForKey={setExtraArgValueForKey}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Tool Calling */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-(--fg) pb-2 border-b border-(--border)/50">
          <Wrench className="w-4 h-4 text-(--accent)" />
          <span className="text-sm font-medium">Tool Calling</span>
        </div>

        <div>
          <label className="block text-xs font-medium text-(--dim) mb-2">Tool Call Parser</label>
          <select
            value={recipe.tool_call_parser || ""}
            onChange={(e) => onChange({ ...recipe, tool_call_parser: e.target.value || undefined })}
            className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-md text-sm focus:outline-none focus:border-(--accent)"
          >
            <option value="">None</option>
            <optgroup label="General">
              <option value="hermes">Hermes</option>
              <option value="pythonic">Pythonic</option>
              <option value="openai">OpenAI</option>
            </optgroup>
            <optgroup label="Llama">
              <option value="llama3_json">Llama 3 JSON</option>
              <option value="llama4_json">Llama 4 JSON</option>
              <option value="llama4_pythonic">Llama 4 Pythonic</option>
            </optgroup>
            <optgroup label="DeepSeek">
              <option value="deepseek_v3">DeepSeek V3</option>
              <option value="deepseek_v31">DeepSeek V3.1</option>
              <option value="deepseek_v32">DeepSeek V3.2</option>
            </optgroup>
            <optgroup label="Qwen">
              <option value="qwen3_xml">Qwen3 XML</option>
              <option value="qwen3_coder">Qwen3 Coder</option>
            </optgroup>
            <optgroup label="GLM">
              <option value="glm45">GLM-4.5</option>
              <option value="glm47">GLM-4.7</option>
            </optgroup>
            <optgroup label="Other">
              <option value="mistral">Mistral</option>
              <option value="granite">Granite</option>
              <option value="minimax">MiniMax</option>
              <option value="kimi_k2">Kimi K2</option>
            </optgroup>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-(--dim) mb-2">Tool Parser Plugin</label>
          <input
            type="text"
            value={recipe.tool_parser_plugin || ""}
            onChange={(e) =>
              onChange({ ...recipe, tool_parser_plugin: e.target.value || undefined })
            }
            placeholder="Path to custom parser module"
            className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-md text-sm focus:outline-none focus:border-(--accent)"
          />
        </div>

        <div className="flex items-center gap-3 p-3 bg-(--bg) border border-(--border) rounded-md">
          <input
            type="checkbox"
            id="enable_auto_tool_choice"
            checked={recipe.enable_auto_tool_choice || false}
            onChange={(e) => onChange({ ...recipe, enable_auto_tool_choice: e.target.checked })}
            className="rounded border-(--border) bg-(--surface) w-4 h-4"
          />
          <div className="flex-1">
            <label
              htmlFor="enable_auto_tool_choice"
              className="text-sm font-medium text-(--fg) cursor-pointer"
            >
              Enable Auto Tool Choice
            </label>
            <p className="text-xs text-(--dim)">Automatically decide when to use tools</p>
          </div>
        </div>
      </div>

      {/* Reasoning */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-(--fg) pb-2 border-b border-(--border)/50">
          <Brain className="w-4 h-4 text-(--accent)" />
          <span className="text-sm font-medium">Reasoning & Thinking</span>
        </div>

        <div>
          <label className="block text-xs font-medium text-(--dim) mb-2">Reasoning Parser</label>
          <select
            value={recipe.reasoning_parser || ""}
            onChange={(e) => onChange({ ...recipe, reasoning_parser: e.target.value || undefined })}
            className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-md text-sm focus:outline-none focus:border-(--accent)"
          >
            <option value="">None</option>
            <optgroup label="DeepSeek">
              <option value="deepseek_r1">DeepSeek R1</option>
              <option value="deepseek_v3">DeepSeek V3</option>
            </optgroup>
            <optgroup label="Others">
              <option value="qwen3">Qwen3</option>
              <option value="glm45">GLM-4.5</option>
              <option value="granite">Granite</option>
            </optgroup>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-(--dim) mb-2">
            Guided Decoding Backend
          </label>
          <input
            type="text"
            value={recipe.guided_decoding_backend || ""}
            onChange={(e) =>
              onChange({ ...recipe, guided_decoding_backend: e.target.value || undefined })
            }
            placeholder="e.g., xgrammar, outlines"
            className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-md text-sm focus:outline-none focus:border-(--accent)"
          />
        </div>

        <div className="flex items-center gap-3 p-3 bg-(--bg) border border-(--border) rounded-md">
          <input
            type="checkbox"
            id="enable_thinking"
            checked={recipe.enable_thinking || false}
            onChange={(e) => onChange({ ...recipe, enable_thinking: e.target.checked })}
            className="rounded border-(--border) bg-(--surface) w-4 h-4"
          />
          <div className="flex-1">
            <label
              htmlFor="enable_thinking"
              className="text-sm font-medium text-(--fg) cursor-pointer"
            >
              Enable Thinking Mode
            </label>
            <p className="text-xs text-(--dim)">Show model&apos;s thinking process</p>
          </div>
        </div>

        {recipe.enable_thinking && (
          <div>
            <label className="block text-xs font-medium text-(--dim) mb-2">
              Thinking Budget (tokens)
            </label>
            <input
              type="number"
              value={recipe.thinking_budget || ""}
              onChange={(e) =>
                onChange({ ...recipe, thinking_budget: Number(e.target.value) || undefined })
              }
              placeholder="1024"
              className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-md text-sm focus:outline-none focus:border-(--accent)"
            />
          </div>
        )}
      </div>

      {/* Chat & Server */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-(--fg) pb-2 border-b border-(--border)/50">
          <MessageSquare className="w-4 h-4 text-(--accent)" />
          <span className="text-sm font-medium">Chat & Templates</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-(--dim) mb-2">Chat Template</label>
            <input
              type="text"
              value={recipe.chat_template || ""}
              onChange={(e) => onChange({ ...recipe, chat_template: e.target.value || undefined })}
              placeholder="Path or name"
              className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-md text-sm focus:outline-none focus:border-(--accent)"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-(--dim) mb-2">Response Role</label>
            <input
              type="text"
              value={recipe.response_role || ""}
              onChange={(e) => onChange({ ...recipe, response_role: e.target.value || undefined })}
              placeholder="assistant"
              className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-md text-sm focus:outline-none focus:border-(--accent)"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-(--dim) mb-2">
            Chat Template Format
          </label>
          <select
            value={recipe.chat_template_content_format || "auto"}
            onChange={(e) =>
              onChange({
                ...recipe,
                chat_template_content_format:
                  e.target.value === "auto"
                    ? undefined
                    : (e.target.value as "auto" | "string" | "openai"),
              })
            }
            className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-md text-sm focus:outline-none focus:border-(--accent)"
          >
            <option value="auto">Auto</option>
            <option value="string">String</option>
            <option value="openai">OpenAI</option>
          </select>
        </div>
      </div>
    </div>
  );
}
