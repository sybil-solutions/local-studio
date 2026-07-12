"use client";

import type {
  ChangeEventHandler,
  ClipboardEventHandler,
  KeyboardEventHandler,
  RefObject,
} from "react";

export function AgentComposerTextArea({
  inputRef,
  value,
  onPaste,
  onChange,
  onKeyDown,
}: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onPaste: ClipboardEventHandler<HTMLTextAreaElement>;
  onChange: ChangeEventHandler<HTMLTextAreaElement>;
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
}) {
  return (
    <textarea
      ref={inputRef}
      rows={1}
      value={value}
      onPaste={onPaste}
      onChange={onChange}
      onKeyDown={onKeyDown}
      placeholder="Ask for follow-up changes"
      className="min-h-[54px] max-h-[50vh] w-full resize-none overflow-y-auto bg-transparent px-4 pb-1.5 pt-3 text-[length:var(--fs-lg)] leading-normal tracking-normal text-(--fg) outline-none placeholder:text-(--hl2)"
    />
  );
}
