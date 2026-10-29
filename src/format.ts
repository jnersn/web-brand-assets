// Formatting that ends up in the HTML pages Chrome renders. The output of each function is part of what
// makes the generated images byte-for-byte reproducible, so a change here changes the images.

/** Escape &, <, >, " and ' for HTML text and attribute values. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/**
 * A file:// URL for an absolute POSIX path. Everything but letters, digits, `_.-~/` is percent-encoded
 * as UTF-8 (url.pathToFileURL leaves more characters, such as `!$&'()+,;=@`, unencoded).
 */
export function fileUrl(path: string): string {
  if (!path.startsWith("/")) throw new Error(`not an absolute path: ${path}`);
  let out = "file://";
  for (const ch of path) {
    if (/^[A-Za-z0-9_.\-~/]$/.test(ch)) out += ch;
    else for (const byte of Buffer.from(ch, "utf8")) out += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

/** Round to the nearest integer, halves to even (so 2.5 gives 2, as before). */
export function roundHalfEven(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff !== 0.5) return Math.round(x);
  return floor % 2 === 0 ? floor : floor + 1;
}

/** Round a non-negative number to two decimals; an exact tie goes to the even digit. */
export function roundTo2(x: number): number {
  const up = x.toFixed(2);
  // toFixed rounds an exact tie up; find exact ties from the full decimal expansion.
  const tie = /^(\d+)\.(\d\d)50*$/.exec(x.toFixed(100));
  if (!tie) return Number(up);
  const down = `${tie[1]}.${tie[2]}`;
  return Number(Number(down.slice(-1)) % 2 === 0 ? down : up);
}

/** A number with at least one decimal, the way the share page has always written it: 10 gives "10.0". */
export function formatDecimal(x: number): string {
  if (!Number.isFinite(x)) return String(x);
  const text = String(x);
  return Number.isInteger(x) && !/e/.test(text) ? `${text}.0` : text;
}
