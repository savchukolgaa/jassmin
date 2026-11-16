import { describe, expect, it } from "vitest";
import { createSseParser } from "./sse";

describe("createSseParser (#164)", () => {
  it("parses event frames, joining data lines and skipping comments", () => {
    const parser = createSseParser();
    expect(parser.push('event: step\ndata: {"a":1}\n\n: ping\n\ndata: one\ndata: two\n\n')).toEqual(
      [
        { event: "step", data: '{"a":1}' },
        { event: "message", data: "one\ntwo" },
      ],
    );
  });

  it("handles frames split anywhere, and CRLF line ends", () => {
    const parser = createSseParser();
    const text = "event: intro\r\ndata: Ось свіжі.\r\n\r\nevent: done\r\ndata: {}\r\n\r\n";
    const messages = [...text].flatMap((char) => parser.push(char));
    expect(messages).toEqual([
      { event: "intro", data: "Ось свіжі." },
      { event: "done", data: "{}" },
    ]);
  });

  it("keeps the value's spaces after the first, and ignores unknown fields", () => {
    const parser = createSseParser();
    expect(parser.push("id: 7\nretry: 10\ndata:  two spaces\ndata:none\n\n")).toEqual([
      { event: "message", data: " two spaces\nnone" },
    ]);
  });

  it("gives a last frame without its blank line at the end", () => {
    const parser = createSseParser();
    expect(parser.push("event: done\ndata: {}")).toEqual([]);
    expect(parser.end()).toEqual([{ event: "done", data: "{}" }]);
    expect(createSseParser().end()).toEqual([]);
  });
});
