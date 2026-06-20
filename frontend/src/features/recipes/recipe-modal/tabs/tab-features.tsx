"use client";

import { Brain, MessageSquare, Settings, Wrench } from "@/ui/icon-registry";
import { CheckboxRow, FormField, FormSection, Input, Select } from "@/ui";
import { ENGINE_LABEL, getEngineOptions } from "@/features/recipes/engine-capabilities";
import { EngineOptionsSection } from "../engine-options-section";
import type { RecipeModalSectionProps, RecipeModalTabProps } from "./tab-props";

export function RecipeModalTabFeatures({
  recipe,
  onChange,
  capabilities,
  getExtraArgValueForKey,
  setExtraArgValueForKey,
}: RecipeModalTabProps) {
  const options = getEngineOptions(capabilities.options, "features");
  return (
    <div className="space-y-6">
      <ToolCallingSection recipe={recipe} onChange={onChange} capabilities={capabilities} />
      <ReasoningSection recipe={recipe} onChange={onChange} capabilities={capabilities} />
      <ChatTemplatesSection recipe={recipe} onChange={onChange} capabilities={capabilities} />
      {options.length ? (
        <EngineOptionsSection
          title={`${ENGINE_LABEL[capabilities.backend]} Sampling & Features`}
          icon={<Settings className="h-4 w-4" />}
          options={options}
          helpText={
            capabilities.options === "llamacpp"
              ? "All llama.cpp flags are supported via Extra CLI Arguments. These cover the most-used options."
              : undefined
          }
          getValueForKey={getExtraArgValueForKey}
          setValueForKey={setExtraArgValueForKey}
        />
      ) : null}
    </div>
  );
}

type SectionProps = RecipeModalSectionProps;

function ToolCallingSection({ recipe, onChange, capabilities }: SectionProps) {
  if (!capabilities.toolCalling) return null;
  const isVllm = capabilities.backend === "vllm";
  return (
    <FormSection icon={<Wrench className="h-4 w-4" />} title="Tool Calling">
      <FormField label="Tool Call Parser">
        <Select
          value={recipe.tool_call_parser || ""}
          onChange={(e) => onChange({ ...recipe, tool_call_parser: e.target.value || undefined })}
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
        </Select>
      </FormField>
      {isVllm ? (
        <>
          <FormField label="Tool Parser Plugin">
            <Input
              type="text"
              value={recipe.tool_parser_plugin || ""}
              onChange={(e) =>
                onChange({ ...recipe, tool_parser_plugin: e.target.value || undefined })
              }
              placeholder="Path to custom parser module"
            />
          </FormField>
          <CheckboxRow
            checked={recipe.enable_auto_tool_choice || false}
            onChange={(checked) => onChange({ ...recipe, enable_auto_tool_choice: checked })}
            label="Enable Auto Tool Choice"
            description="Automatically decide when to use tools"
          />
        </>
      ) : null}
    </FormSection>
  );
}

function ReasoningSection({ recipe, onChange, capabilities }: SectionProps) {
  if (!capabilities.reasoning) return null;
  const isVllm = capabilities.backend === "vllm";
  return (
    <FormSection icon={<Brain className="h-4 w-4" />} title="Reasoning & Thinking">
      <FormField label="Reasoning Parser">
        <Select
          value={recipe.reasoning_parser || ""}
          onChange={(e) => onChange({ ...recipe, reasoning_parser: e.target.value || undefined })}
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
        </Select>
      </FormField>
      {isVllm ? (
        <>
          <FormField label="Guided Decoding Backend">
            <Input
              type="text"
              value={recipe.guided_decoding_backend || ""}
              onChange={(e) =>
                onChange({ ...recipe, guided_decoding_backend: e.target.value || undefined })
              }
              placeholder="e.g., xgrammar, outlines"
            />
          </FormField>
          <CheckboxRow
            checked={recipe.enable_thinking || false}
            onChange={(checked) => onChange({ ...recipe, enable_thinking: checked })}
            label="Enable Thinking Mode"
            description="Show the model's thinking process"
          />
          {recipe.enable_thinking ? (
            <FormField label="Thinking Budget (tokens)">
              <Input
                type="number"
                value={recipe.thinking_budget || ""}
                onChange={(e) =>
                  onChange({ ...recipe, thinking_budget: Number(e.target.value) || undefined })
                }
                placeholder="1024"
              />
            </FormField>
          ) : null}
        </>
      ) : null}
    </FormSection>
  );
}

function ChatTemplatesSection({ recipe, onChange, capabilities }: SectionProps) {
  if (!capabilities.chatTemplates) return null;
  const isVllm = capabilities.backend === "vllm";
  return (
    <FormSection icon={<MessageSquare className="h-4 w-4" />} title="Chat & Templates">
      <div className={isVllm ? "grid grid-cols-2 gap-3" : undefined}>
        <FormField label="Chat Template">
          <Input
            type="text"
            value={recipe.chat_template || ""}
            onChange={(e) => onChange({ ...recipe, chat_template: e.target.value || undefined })}
            placeholder="Path or name"
          />
        </FormField>
        {isVllm ? (
          <FormField label="Response Role">
            <Input
              type="text"
              value={recipe.response_role || ""}
              onChange={(e) => onChange({ ...recipe, response_role: e.target.value || undefined })}
              placeholder="assistant"
            />
          </FormField>
        ) : null}
      </div>
      {isVllm ? (
        <FormField label="Chat Template Format">
          <Select
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
          >
            <option value="auto">Auto</option>
            <option value="string">String</option>
            <option value="openai">OpenAI</option>
          </Select>
        </FormField>
      ) : null}
    </FormSection>
  );
}
