// Parse a fetch Response body as JSON in a way that can't throw the cryptic
// "Unexpected end of JSON input" SyntaxError when the server returns an empty
// body, an HTML error page, or an aborted stream. Callers always get either a
// parsed object or a clear Error.
export async function safeJson<T = unknown>(response: Response): Promise<T> {
  let text: string;
  try {
    text = await response.text();
  } catch (err) {
    throw new Error(
      response.ok
        ? `Failed to read response: ${err instanceof Error ? err.message : "unknown error"}`
        : `HTTP ${response.status}`,
    );
  }
  if (!text) {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return {} as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    throw new Error("Malformed response from server");
  }
}
