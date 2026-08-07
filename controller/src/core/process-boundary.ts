import { format } from "node:util";
import { redactLogLine } from "./log-redaction";

const methods = ["debug", "info", "log", "warn", "error"] as const;

process.umask(0o077);

for (const method of methods) {
  const output = console[method].bind(console);
  console[method] = (...values: unknown[]): void => {
    const rendered = values.length === 0 ? "" : format(values[0], ...values.slice(1));
    output(redactLogLine(rendered));
  };
}
