"use client";

import { useState } from "react";
import { Code2 } from "lucide-react";

import { useTools } from "@/lib/agent/tools/context";
import { RenderedPreview, detectPreviewKind } from "./filesystem-preview";

// The canvas is a shared human↔model buffer. It can hold Markdown, HTML, or
// JSX, so by default we render it (kind inferred from the content) and offer an
// explicit Edit toggle to drop back to the raw textarea.
export function CanvasPanel() {
  const tools = useTools();
  const text = tools.computer.canvasText;
  const [editing, setEditing] = useState(false);
  const hasContent = text.trim().length > 0;
  const kind = detectPreviewKind(text);
  const showPreview = !editing && hasContent;
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-(--border) px-3 text-xs">
        <Code2 className="h-3.5 w-3.5 text-(--accent)/70" />
        <span className="font-medium text-(--fg)">Canvas</span>
        {showPreview ? (
          <span className="rounded bg-(--surface) px-1.5 py-0.5 font-mono text-[length:var(--fs-xs)] uppercase text-(--dim)">
            {kind}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-[length:var(--fs-sm)] text-(--dim)">
          Shared scratchboard for the human and model
        </span>
        {hasContent ? (
          <div className="flex shrink-0 items-center gap-0.5 rounded bg-(--surface) p-0.5">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className={`rounded px-2 py-0.5 text-[length:var(--fs-sm)] ${
                !editing ? "bg-(--hover) text-(--fg)" : "text-(--dim) hover:text-(--fg)"
              }`}
            >
              Preview
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className={`rounded px-2 py-0.5 text-[length:var(--fs-sm)] ${
                editing ? "bg-(--hover) text-(--fg)" : "text-(--dim) hover:text-(--fg)"
              }`}
            >
              Edit
            </button>
          </div>
        ) : null}
        <button
          type="button"
          onClick={tools.toggleCanvas}
          className={`h-6 rounded px-2 text-[length:var(--fs-sm)] ${
            tools.computer.canvasEnabled
              ? "bg-(--accent)/15 text-(--accent)/75"
              : "bg-(--surface) text-(--dim)/75 hover:text-(--fg)/75"
          }`}
          title={
            tools.computer.canvasEnabled
              ? "Canvas shared with the model"
              : "Share the canvas with the model"
          }
        >
          {tools.computer.canvasEnabled ? "On" : "Off"}
        </button>
      </div>
      {showPreview ? (
        <RenderedPreview content={text} kind={kind} />
      ) : (
        <textarea
          value={text}
          onChange={(event) => tools.setCanvasText(event.target.value)}
          placeholder="Scratch notes, live plan, links, state, Markdown, HTML, or JSX — anything the model should keep in view..."
          className="min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-[length:var(--fs-md)] leading-6 text-(--fg) outline-none placeholder:text-(--dim)"
          spellCheck={false}
        />
      )}
    </section>
  );
}
