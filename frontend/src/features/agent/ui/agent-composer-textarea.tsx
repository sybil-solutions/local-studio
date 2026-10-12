"use client";

import {
  useContext,
  useRef,
  type ChangeEventHandler,
  type ClipboardEventHandler,
  type KeyboardEventHandler,
  type RefObject,
} from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { ComposerFocusContext } from "@/features/agent/workspace/pane-context";

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
  const { tabId, composerFocusIntent } = useContext(ComposerFocusContext);
  const lastSeenNonceRef = useRef<number>(0);
  const nonce = composerFocusIntent?.nonce ?? 0;
  useMountSubscription(() => {
    if (nonce === 0 || lastSeenNonceRef.current === nonce) return;
    lastSeenNonceRef.current = nonce;
    if (composerFocusIntent?.targetTabId === tabId) inputRef.current?.focus();
  }, [nonce, composerFocusIntent, tabId, inputRef]);
  return (
    <textarea
      ref={inputRef}
      rows={1}
      value={value}
      onPaste={onPaste}
      onChange={onChange}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      className="min-h-9 max-h-[36vh] w-full resize-none overflow-y-auto bg-transparent px-3.5 pb-0 pt-2.5 text-[length:var(--fs-base)] leading-[1.5] tracking-normal text-(--fg)/82 outline-none placeholder:text-(--composer-placeholder)"
    />
  );
}
