// What to render for each part, the manifest and <head> tags, and writing the output directory.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Config } from "./config.js";
import { escapeHtml } from "./format.js";
import { iconPage, SHARE_SIZE, sharePage, templatePage } from "./pages.js";
import { buildIco, render } from "./render.js";

export const PARTS = ["icons", "manifest", "share"] as const;
export type Part = (typeof PARTS)[number];

const ICO_SIZES = [16, 32, 48];
const MAX_BROWSERS = 4;

export function manifestJson(cfg: Config): string {
  const { manifest: m, basePath: base } = cfg;
  const data = {
    name: cfg.name,
    short_name: m.shortName,
    icons: [
      { src: `${base}icon-192.png`, sizes: "192x192", type: "image/png" },
      { src: `${base}icon-512.png`, sizes: "512x512", type: "image/png" },
      { src: `${base}icon-maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    start_url: m.startUrl,
    display: m.display,
    theme_color: m.themeColor,
    background_color: m.backgroundColor,
  };
  return JSON.stringify(data, null, 2) + "\n";
}

const hasSvgFavicon = (cfg: Config): boolean => path.extname(cfg.favicon).toLowerCase() === ".svg";

export function headTags(cfg: Config, parts: readonly Part[] = PARTS): string {
  const base = cfg.basePath;
  const lines: string[] = [];
  if (parts.includes("icons")) {
    lines.push(`<link rel="icon" href="${base}favicon.ico" sizes="48x48" />`);
    if (hasSvgFavicon(cfg)) lines.push(`<link rel="icon" href="${base}favicon.svg" type="image/svg+xml" />`);
    lines.push(`<link rel="icon" href="${base}favicon-96x96.png" sizes="96x96" type="image/png" />`);
    lines.push(`<link rel="apple-touch-icon" href="${base}apple-touch-icon.png" />`);
  }
  if (parts.includes("manifest")) {
    lines.push(`<link rel="manifest" href="${base}site.webmanifest" />`);
    lines.push(`<meta name="theme-color" content="${escapeHtml(cfg.manifest.themeColor)}" />`);
  }
  const share = cfg.share;
  if (parts.includes("share") && share) {
    const prefix = cfg.siteUrl ?? "";
    if (!prefix) lines.push("<!-- Share images need an absolute URL: set site_url in the config. -->");
    const [w, h] = SHARE_SIZE;
    lines.push(
      `<meta property="og:image" content="${escapeHtml(prefix + base + share.file)}" />`,
      `<meta property="og:image:width" content="${w}" />`,
      `<meta property="og:image:height" content="${h}" />`,
      `<meta property="og:image:alt" content="${escapeHtml(share.alt)}" />`,
      '<meta name="twitter:card" content="summary_large_image" />',
    );
  }
  return lines.join("\n");
}

export interface Job {
  file: string;
  page: string;
  width: number;
  height: number;
}

/** Every image to render. ico-N.png are the parts of favicon.ico. */
export function plan(cfg: Config, parts: readonly Part[]): Job[] {
  const jobs: Job[] = [];
  const square = (file: string, page: string, size: number) => jobs.push({ file, page, width: size, height: size });
  if (parts.includes("icons")) {
    const { favicon, icon, maskable } = cfg;
    for (const n of ICO_SIZES) square(`ico-${n}.png`, iconPage(favicon, n), n);
    square("favicon-96x96.png", iconPage(favicon, 96), 96);
    // iOS fills transparent pixels with black, so the touch icon gets an opaque backdrop.
    square("apple-touch-icon.png", iconPage(icon, 180, 1.0, cfg.manifest.backgroundColor), 180);
    for (const n of [192, 512]) square(`icon-${n}.png`, iconPage(icon, n), n);
    square("icon-maskable-512.png", iconPage(maskable.source, 512, maskable.scale, maskable.background), 512);
  }
  if (parts.includes("share") && cfg.share) {
    const share = cfg.share;
    const page = share.template
      ? templatePage(share.template, { title: share.title, tagline: share.tagline, name: cfg.name })
      : sharePage(share);
    jobs.push({ file: share.file, page, width: SHARE_SIZE[0], height: SHARE_SIZE[1] });
  }
  return jobs;
}

/** Render every job, a few browsers at a time. All jobs run; the first failure in plan order is thrown. */
async function renderAll(chrome: string, jobs: Job[], work: string): Promise<void> {
  const results: Promise<unknown>[] = [];
  const queue = jobs.entries();
  const worker = async () => {
    for (const [i, job] of queue) {
      results[i] = render(chrome, job.page, job.width, job.height, path.join(work, job.file), work);
      await results[i].catch(() => undefined);
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_BROWSERS, jobs.length) }, worker));
  for (const result of results) await result;
}

/**
 * Render into a scratch directory, then write the results into OUTPUT, so a failed run leaves OUTPUT as it was.
 * Returns the names of the files written, sorted.
 */
export async function generateFiles(cfg: Config, chrome: string, output: string, parts: readonly Part[] = PARTS): Promise<string[]> {
  const files = new Map<string, Buffer>();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "web-brand-assets-"));
  try {
    const jobs = plan(cfg, parts);
    await renderAll(chrome, jobs, work);
    for (const job of jobs) files.set(job.file, fs.readFileSync(path.join(work, job.file)));
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  if (parts.includes("icons")) {
    const pngs = ICO_SIZES.map((n) => files.get(`ico-${n}.png`) as Buffer);
    for (const n of ICO_SIZES) files.delete(`ico-${n}.png`);
    files.set("favicon.ico", buildIco(pngs));
    if (hasSvgFavicon(cfg)) files.set("favicon.svg", fs.readFileSync(cfg.favicon));
  }
  if (parts.includes("manifest")) files.set("site.webmanifest", Buffer.from(manifestJson(cfg)));
  fs.mkdirSync(output, { recursive: true });
  for (const [name, data] of files) fs.writeFileSync(path.join(output, name), data);
  return [...files.keys()].sort();
}
