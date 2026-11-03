import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { woffToSfnt } from "./woff";

const require = createRequire(import.meta.url);
const woff = readFileSync(
  require.resolve("@fontsource/manrope/files/manrope-latin-800-normal.woff"),
);

describe("woffToSfnt", () => {
  it("unpacks every table of a WOFF font into a TrueType font", () => {
    const sfnt = woffToSfnt(woff);
    const numTables = woff.readUInt16BE(12);

    expect(sfnt.readUInt32BE(0)).toBe(0x00010000);
    expect(sfnt.readUInt16BE(4)).toBe(numTables);
    const tags: string[] = [];
    for (let i = 0; i < numTables; i++) {
      const record = 12 + i * 16;
      const offset = sfnt.readUInt32BE(record + 8);
      const length = sfnt.readUInt32BE(record + 12);
      expect(offset % 4).toBe(0);
      expect(offset + length).toBeLessThanOrEqual(sfnt.length);
      tags.push(sfnt.subarray(record, record + 4).toString("latin1"));
    }
    expect(tags).toEqual(expect.arrayContaining(["cmap", "glyf", "head", "hmtx", "name"]));
    // The `head` table's magic number survives the round trip.
    const head = tags.indexOf("head");
    const headOffset = sfnt.readUInt32BE(12 + head * 16 + 8);
    expect(sfnt.readUInt32BE(headOffset + 12)).toBe(0x5f0f3cf5);
  });

  it("throws for anything that isn't WOFF", () => {
    expect(() => woffToSfnt(Buffer.from("not a font at all, just some text here"))).toThrow(
      "Not a WOFF 1.0 font",
    );
  });
});
