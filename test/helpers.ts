import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { ConfigError } from "../src/config.js";
import { findChrome } from "../src/render.js";

export const EXAMPLES = fileURLToPath(new URL("../../examples/", import.meta.url));
export const EXAMPLE_CONFIG = path.join(EXAMPLES, "web-brand-assets.json");

export const CHROME: string | null = (() => {
  try {
    return findChrome();
  } catch (e) {
    if (e instanceof ConfigError) return null;
    throw e;
  }
})();

export function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wba-test-"));
}

export function write(file: string, text: string): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
  return file;
}

export function svg(fill = "#123456", rx = 0): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="${rx}" fill="${fill}"/></svg>`;
}

/** A minimal valid PNG header, enough for pngSize and buildIco. */
export function png(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(13);
  return Buffer.concat([Buffer.from("\x89PNG\r\n\x1a\n", "latin1"), len, Buffer.from("IHDR"), ihdr, Buffer.alloc(4)]);
}

export type RGBA = [number, number, number, number];

/** Decode an 8-bit RGBA or RGB, non-interlaced PNG into rows of RGBA tuples. */
export function pixels(file: string): RGBA[][] {
  const data = fs.readFileSync(file);
  let pos = 8;
  let width = 0;
  let height = 0;
  let color = 0;
  const idat: Buffer[] = [];
  while (pos < data.length) {
    const n = data.readUInt32BE(pos);
    const kind = data.toString("latin1", pos + 4, pos + 8);
    const body = data.subarray(pos + 8, pos + 8 + n);
    if (kind === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      color = body[9];
    } else if (kind === "IDAT") {
      idat.push(body);
    }
    pos += 12 + n;
  }
  const bpp = ({ 6: 4, 2: 3 } as Record<number, number>)[color];
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const rows: RGBA[][] = [];
  let prev = new Uint8Array(stride);
  let i = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[i];
    const line = Uint8Array.from(raw.subarray(i + 1, i + 1 + stride));
    i += 1 + stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      if (f === 1) line[x] = (line[x] + a) & 255;
      else if (f === 2) line[x] = (line[x] + b) & 255;
      else if (f === 3) line[x] = (line[x] + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    const row: RGBA[] = [];
    for (let x = 0; x < stride; x += bpp) {
      row.push([line[x], line[x + 1], line[x + 2], bpp === 4 ? line[x + 3] : 255]);
    }
    rows.push(row);
    prev = line;
  }
  return rows;
}

/** Capture what the command line prints. */
export function capture() {
  const io = { stdout: "", stderr: "", out: (t: string) => void (io.stdout += t), err: (t: string) => void (io.stderr += t) };
  return io;
}
