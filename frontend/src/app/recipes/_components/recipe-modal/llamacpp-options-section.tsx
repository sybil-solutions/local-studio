"use client";

import { Settings } from "lucide-react";
import { LLAMACPP_OPTIONS } from "../../llamacpp-options";

type LlamacppTab = "model" | "resources" | "performance" | "features";

function coerceBooleanValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.toLowerCase().trim();
    if (["true", "1", "yes", "y"].includes(normalized)) return true;
    if (["false", "0", "no", "n"].includes(normalized)) return false;
  }
  return false;
}

export function LlamacppOptionsSection({
  tab,
  getValueForKey,
  setValueForKey,
}: {
  tab: LlamacppTab;
  getValueForKey: (key: string) => unknown;
  setValueForKey: (key: string, value: unknown) => void;
}) {
  const options = LLAMACPP_OPTIONS.filter((option) => option.tab === tab);
  if (options.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-(--fg) pb-2 border-b border-(--border)/50">
        <Settings className="w-4 h-4 text-(--accent)" />
        <span className="text-sm font-medium">llama.cpp Options</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {options.map((option) => {
          const value = getValueForKey(option.key);
          const wide =
            option.type === "text" && /prompt|template|grammar|control|model/.test(option.key);
          if (option.type === "boolean") {
            return (
              <label
                key={option.key}
                className={`flex items-center gap-2 px-3 py-2 bg-(--bg) border border-(--border) rounded-md text-xs text-(--dim) ${
                  wide ? "col-span-2" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={coerceBooleanValue(value)}
                  onChange={(e) => setValueForKey(option.key, e.target.checked ? true : undefined)}
                  className="accent-(--accent)"
                />
                {option.label}
              </label>
            );
          }
          if (option.type === "select") {
            return (
              <div key={option.key} className={wide ? "col-span-2" : ""}>
                <label className="block text-xs font-medium text-(--dim) mb-2">
                  {option.label}
                </label>
                <select
                  value={value ? String(value) : ""}
                  onChange={(e) => setValueForKey(option.key, e.target.value || undefined)}
                  className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-md text-sm focus:outline-none focus:border-(--accent)"
                >
                  <option value="">Default</option>
                  {option.options?.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </select>
              </div>
            );
          }

          const inputType = option.type === "number" ? "number" : "text";
          return (
            <div key={option.key} className={wide ? "col-span-2" : ""}>
              <label className="block text-xs font-medium text-(--dim) mb-2">{option.label}</label>
              <input
                type={inputType}
                value={value !== undefined && value !== null ? String(value) : ""}
                onChange={(e) =>
                  setValueForKey(
                    option.key,
                    inputType === "number"
                      ? e.target.value
                        ? Number(e.target.value)
                        : undefined
                      : e.target.value,
                  )
                }
                placeholder={option.placeholder}
                className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-md text-sm focus:outline-none focus:border-(--accent)"
              />
            </div>
          );
        })}
      </div>
      <p className="text-xs text-(--dim)">
        All llama.cpp flags are supported via Extra CLI Arguments. These fields cover the most-used
        options.
      </p>
    </div>
  );
}
