type ClipboardWriter = Pick<Clipboard, "writeText">;

type ClipboardWriteOptions = {
  clipboard?: ClipboardWriter | null;
  fallback?: (value: string) => boolean;
};

function copyWithSelection(value: string): boolean {
  if (typeof document === "undefined" || !document.body) return false;
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, value.length);
  const copied = document.execCommand("copy");
  textarea.remove();
  previous?.focus();
  return copied;
}

export async function writeClipboardText(
  value: string,
  options: ClipboardWriteOptions = {},
): Promise<void> {
  const clipboard =
    options.clipboard === undefined
      ? typeof navigator === "undefined"
        ? null
        : navigator.clipboard
      : options.clipboard;
  if (clipboard?.writeText) {
    await clipboard.writeText(value);
    return;
  }
  if (!(options.fallback ?? copyWithSelection)(value)) {
    throw new Error("Clipboard access is unavailable in this browser.");
  }
}
