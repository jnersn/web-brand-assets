// The HTML pages Chrome screenshots: an icon on a square canvas, and the share image.

import * as fs from "node:fs";
import * as path from "node:path";
import type { Share } from "./config.js";
import { escapeHtml, fileUrl, formatDecimal, roundHalfEven, roundTo2 } from "./format.js";

export const SHARE_SIZE = [1200, 630] as const;

const FONT_FORMATS: Record<string, string> = { ".woff2": "woff2", ".woff": "woff", ".ttf": "truetype", ".otf": "opentype" };
const SYSTEM_FONTS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** A page that shows SOURCE centred at SCALE of a SIZE x SIZE canvas. */
export function iconPage(source: string, size: number, scale = 1.0, background = "transparent"): string {
  const inner = roundHalfEven(size * scale);
  return (
    '<!doctype html><html><head><meta charset="utf-8"><style>' +
    `html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden;background:${background}}` +
    "body{display:flex;align-items:center;justify-content:center}" +
    `img{display:block;width:${inner}px;height:${inner}px}` +
    `</style></head><body><img src="${escapeHtml(fileUrl(source))}" alt=""></body></html>`
  );
}

function fontFace(family: string, file: string): string {
  const format = FONT_FORMATS[path.extname(file).toLowerCase()];
  // A weight range lets a variable font serve every weight; a static font is used as it is.
  return `@font-face{font-family:"${family}";font-weight:100 900;font-display:block;src:url("${fileUrl(file)}") format("${format}")}`;
}

/** The built-in share image layout: mark, title and tagline on the left of a 1200 x 630 canvas. */
export function sharePage(share: Share): string {
  const faces: string[] = [];
  let bodyFamily = SYSTEM_FONTS;
  if (share.bodyFont) {
    faces.push(fontFace("Brand Body", share.bodyFont));
    bodyFamily = `"Brand Body", ${SYSTEM_FONTS}`;
  }
  let titleFamily = bodyFamily;
  if (share.titleFont) {
    faces.push(fontFace("Brand Title", share.titleFont));
    titleFamily = `"Brand Title", ${bodyFamily}`;
  }
  let glow = "none";
  if (share.glow) {
    const pct = formatDecimal(roundTo2(share.glowOpacity * 100));
    glow = `linear-gradient(225deg, color-mix(in srgb, ${share.glow} ${pct}%, transparent), transparent 55%)`;
  }
  const mark = share.mark ? `<img class="mark" src="${escapeHtml(fileUrl(share.mark))}" alt="">` : "";
  const tagline = share.tagline ? `<p>${escapeHtml(share.tagline)}</p>` : "";
  const [w, h] = SHARE_SIZE;
  return (
    '<!doctype html><html><head><meta charset="utf-8"><style>' +
    faces.join("") +
    `html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden}` +
    "body{box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;padding:0 110px;" +
    `background-color:${share.background};background-image:${glow};color:${share.titleColor};` +
    `font-family:${bodyFamily}}` +
    ".mark{display:block;width:auto;height:140px;max-width:640px;margin-bottom:56px;align-self:flex-start}" +
    `h1{margin:0 0 12px;font-family:${titleFamily};font-weight:${share.titleWeight};font-size:96px;` +
    "line-height:1.05;letter-spacing:-0.02em;overflow-wrap:anywhere}" +
    `p{margin:0;font-size:40px;line-height:1.3;color:${share.taglineColor}}` +
    `</style></head><body>${mark}<h1>${escapeHtml(share.title)}</h1>${tagline}</body></html>`
  );
}

/**
 * A custom share template with {{title}}, {{tagline}} and {{name}} filled in (HTML-escaped).
 * A <base> element keeps the template's relative links (fonts, images, CSS) pointing next to it.
 */
export function templatePage(template: string, values: { title: string; tagline: string; name: string }): string {
  // Line endings are normalised to \n, so a template renders the same whatever line endings it was saved with.
  let page = fs.readFileSync(template, "utf8").replace(/\r\n?/g, "\n");
  page = page.replace(/\{\{\s*(title|tagline|name)\s*\}\}/g, (_, key: keyof typeof values) => escapeHtml(values[key]));
  const base = `<base href="${escapeHtml(fileUrl(path.dirname(template)))}/">`;
  const head = /<head[^>]*>/i.exec(page);
  if (!head) return base + page;
  const end = head.index + head[0].length;
  return page.slice(0, end) + base + page.slice(end);
}
