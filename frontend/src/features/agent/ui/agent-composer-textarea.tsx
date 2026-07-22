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
  placeholder = "Ask for follow-up changes",
}: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onPaste: ClipboardEventHandler<HTMLTextAreaElement>;
  onChange: ChangeEventHandler<HTMLTextAreaElement>;
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
  placeholder?: string;
}) {
  return (
    <textarea
      ref={inputRef}
      rows={1}
      value={value}
      onPaste={onPaste}
      onChange={onChange}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      className="min-h-11 max-h-[36vh] w-full resize-none overflow-y-auto bg-transparent px-4 pb-0 pt-3.5 text-[length:var(--codex-chat-font-size)] leading-[1.5] tracking-normal text-(--fg)/82 outline-none placeholder:text-(--composer-placeholder)"
    />
  );
}
