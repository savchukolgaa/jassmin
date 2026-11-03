import { inflateSync } from "node:zlib";

// WOFF 1.0 → plain TrueType/OpenType (#105). resvg reads only TTF/OTF, and `@fontsource` ships
// WOFF: each table is zlib-compressed on its own, so unpacking is inflating every table and writing
// a standard table directory in front of them. https://www.w3.org/TR/WOFF/

const WOFF_SIGNATURE = 0x774f4646; // "wOFF"
const WOFF_HEADER_SIZE = 44;
const WOFF_ENTRY_SIZE = 20;
const SFNT_HEADER_SIZE = 12;
const SFNT_ENTRY_SIZE = 16;

interface Table {
  tag: number;
  checksum: number;
  data: Buffer;
}

const pad4 = (length: number) => (length + 3) & ~3;

/** The font in `woff` as an SFNT (`.ttf` / `.otf`) buffer. Throws if it isn't WOFF 1.0. */
export function woffToSfnt(woff: Buffer): Buffer {
  if (woff.length < WOFF_HEADER_SIZE || woff.readUInt32BE(0) !== WOFF_SIGNATURE) {
    throw new Error("Not a WOFF 1.0 font");
  }
  const flavor = woff.readUInt32BE(4);
  const numTables = woff.readUInt16BE(12);

  const tables: Table[] = [];
  for (let i = 0; i < numTables; i++) {
    const entry = WOFF_HEADER_SIZE + i * WOFF_ENTRY_SIZE;
    const tag = woff.readUInt32BE(entry);
    const offset = woff.readUInt32BE(entry + 4);
    const compLength = woff.readUInt32BE(entry + 8);
    const origLength = woff.readUInt32BE(entry + 12);
    const checksum = woff.readUInt32BE(entry + 16);
    if (offset + compLength > woff.length) {
      throw new Error("Truncated WOFF font");
    }
    const stored = woff.subarray(offset, offset + compLength);
    const data = compLength < origLength ? inflateSync(stored) : Buffer.from(stored);
    if (data.length !== origLength) {
      throw new Error("Corrupt WOFF table");
    }
    tables.push({ tag, checksum, data });
  }

  const directorySize = SFNT_HEADER_SIZE + numTables * SFNT_ENTRY_SIZE;
  const size = tables.reduce((total, table) => total + pad4(table.data.length), directorySize);
  const sfnt = Buffer.alloc(size);

  const entrySelector = numTables > 0 ? Math.floor(Math.log2(numTables)) : 0;
  const searchRange = 2 ** entrySelector * 16;
  sfnt.writeUInt32BE(flavor, 0);
  sfnt.writeUInt16BE(numTables, 4);
  sfnt.writeUInt16BE(searchRange, 6);
  sfnt.writeUInt16BE(entrySelector, 8);
  sfnt.writeUInt16BE(numTables * 16 - searchRange, 10);

  let offset = directorySize;
  tables.forEach((table, i) => {
    const record = SFNT_HEADER_SIZE + i * SFNT_ENTRY_SIZE;
    sfnt.writeUInt32BE(table.tag, record);
    sfnt.writeUInt32BE(table.checksum, record + 4);
    sfnt.writeUInt32BE(offset, record + 8);
    sfnt.writeUInt32BE(table.data.length, record + 12);
    table.data.copy(sfnt, offset);
    offset += pad4(table.data.length);
  });
  return sfnt;
}
