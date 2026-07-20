import { Buffer } from "node:buffer";
import { createLogPayloadRedactor } from "./log-redaction";

const DEFAULT_MAX_RECORD_CHARS = 64 * 1024;
const REDACTED = "[redacted]";

export type RecordEnding = "" | "\n" | "\r\n";

export interface RedactedRecord<Label> {
  readonly label: Label;
  readonly value: string;
  readonly ending: RecordEnding;
}

export interface RedactedRecordMultiplexer<Label> {
  readonly write: (label: Label, chunk: unknown) => RedactedRecord<Label>[];
  readonly writeRecord: (label: Label, value: string) => RedactedRecord<Label>[];
  readonly flush: () => RedactedRecord<Label>[];
}

const withoutFinalEnding = <Label>(records: RedactedRecord<Label>[]): RedactedRecord<Label>[] => {
  const last = records.at(-1);
  if (!last) return records;
  return [...records.slice(0, -1), { ...last, ending: "" }];
};

const recordChunkText = (chunk: unknown): string =>
  typeof chunk === "string"
    ? chunk
    : chunk instanceof Uint8Array
      ? Buffer.from(chunk).toString("utf8")
      : String(chunk);

export const redactedRecordPayload = <Label>(records: readonly RedactedRecord<Label>[]): string =>
  records.map(({ value, ending }) => `${value}${ending}`).join("");

export const createRedactedRecordMultiplexer = <Label>(
  maximumRecordChars = DEFAULT_MAX_RECORD_CHARS,
): RedactedRecordMultiplexer<Label> => {
  const redactor = createLogPayloadRedactor();
  const limit = Number.isSafeInteger(maximumRecordChars)
    ? Math.max(0, maximumRecordChars)
    : DEFAULT_MAX_RECORD_CHARS;
  let pending = "";
  let pendingLabel: Label | undefined;
  let overflowed = false;

  const write = (label: Label, chunk: unknown): RedactedRecord<Label>[] => {
    const text = recordChunkText(chunk);
    const records: RedactedRecord<Label>[] = [];
    let cursor = 0;
    let newline = text.indexOf("\n", cursor);
    while (newline >= 0) {
      const segmentLength = newline - cursor;
      const withinLimit = !overflowed && pending.length + segmentLength <= limit;
      const record = withinLimit ? pending + text.slice(cursor, newline) : "";
      const carriageReturn = withinLimit && record.endsWith("\r");
      if (!withinLimit) redactor.failClosed();
      records.push({
        label,
        value: withinLimit
          ? redactor.redactLine(carriageReturn ? record.slice(0, -1) : record)
          : REDACTED,
        ending: carriageReturn ? "\r\n" : "\n",
      });
      pending = "";
      pendingLabel = undefined;
      overflowed = false;
      cursor = newline + 1;
      newline = text.indexOf("\n", cursor);
    }
    const remainder = text.slice(cursor);
    if (remainder.length === 0) return records;
    pendingLabel = label;
    if (!overflowed && pending.length + remainder.length <= limit) pending += remainder;
    else {
      if (!overflowed) redactor.failClosed();
      pending = "";
      overflowed = true;
    }
    return records;
  };

  const flush = (): RedactedRecord<Label>[] => {
    if ((!overflowed && pending.length === 0) || pendingLabel === undefined) return [];
    const record = {
      label: pendingLabel,
      value: overflowed ? REDACTED : redactor.redactLine(pending),
      ending: "" as const,
    };
    pending = "";
    pendingLabel = undefined;
    overflowed = false;
    return [record];
  };

  const writeRecord = (label: Label, value: string): RedactedRecord<Label>[] =>
    withoutFinalEnding(write(label, `${value}\n`));

  return { write, writeRecord, flush };
};
