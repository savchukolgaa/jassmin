// A small server-sent-events parser for the perfumer's stream (#164): `fetch` gives the body in
// arbitrary pieces, and `EventSource` can't POST. Follows the format's rules as far as the
// perfumer needs: `event:` and `data:` fields, comments, LF or CRLF line ends, and frames split
// anywhere.

export interface SseMessage {
  /** The `event:` field, or `"message"` when there is none. */
  event: string;
  /** The `data:` lines, joined with "\n". */
  data: string;
}

export interface SseParser {
  /** Adds a decoded piece of the body; returns the messages it completed. */
  push(chunk: string): SseMessage[];
  /** The body ended: returns a last message that had no blank line after it. */
  end(): SseMessage[];
}

export function createSseParser(): SseParser {
  let buffer = "";
  let event = "";
  let data: string[] = [];

  /** Applies one line; returns a message when the line is blank and one was collected. */
  const line = (text: string): SseMessage | undefined => {
    if (text === "") {
      const message = data.length
        ? { event: event || "message", data: data.join("\n") }
        : undefined;
      event = "";
      data = [];
      return message;
    }
    if (text.startsWith(":")) {
      return undefined;
    }
    const colon = text.indexOf(":");
    const field = colon === -1 ? text : text.slice(0, colon);
    let value = colon === -1 ? "" : text.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
    return undefined;
  };

  const lines = (texts: readonly string[]): SseMessage[] =>
    texts.flatMap((text) => {
      const message = line(text.replace(/\r$/, ""));
      return message ? [message] : [];
    });

  return {
    push(chunk) {
      buffer += chunk;
      const parts = buffer.split("\n");
      // The last part has no line end yet: it waits for the next piece.
      buffer = parts.pop() ?? "";
      return lines(parts);
    },
    end() {
      const rest = buffer;
      buffer = "";
      return lines(rest ? [rest, ""] : [""]);
    },
  };
}
