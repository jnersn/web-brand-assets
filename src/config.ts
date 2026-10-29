// Reading and validating the brand config. Paths in it are relative to the config file.

import * as fs from "node:fs";
import * as path from "node:path";

/** A problem with the config or the environment; the command line prints it and exits with status 1. */
export class ConfigError extends Error {
  override name = "ConfigError";
}

export interface Manifest {
  shortName: string;
  startUrl: string;
  display: string;
  themeColor: string;
  backgroundColor: string;
}

export interface Maskable {
  source: string;
  scale: number;
  background: string;
}

export interface Share {
  file: string;
  title: string;
  tagline: string;
  alt: string;
  mark: string | null;
  template: string | null;
  background: string;
  glow: string | null;
  glowOpacity: number;
  titleColor: string;
  taglineColor: string;
  titleFont: string | null;
  titleWeight: string;
  bodyFont: string | null;
}

/** A validated config with defaults filled in; every path is absolute. */
export interface Config {
  name: string;
  icon: string;
  favicon: string;
  output: string;
  basePath: string;
  siteUrl: string | null;
  manifest: Manifest;
  maskable: Maskable;
  share: Share | null;
}

type Json = Record<string, unknown>;

const IMAGES = [".svg", ".png"];
const FONTS = [".woff2", ".woff", ".ttf", ".otf"];
const TEMPLATES = [".html", ".htm"];
// A CSS value from the config goes straight into a stylesheet; these characters would end the declaration.
const UNSAFE_CSS = /[;{}<>\\]/;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** The real path of P, resolving symlinks in the part of it that exists. */
export function realPath(p: string): string {
  const abs = path.resolve(p);
  try {
    return fs.realpathSync(abs);
  } catch {
    const parent = path.dirname(abs);
    return parent === abs ? abs : path.join(realPath(parent), path.basename(abs));
  }
}

/** Read and validate the config file at CONFIGPATH. */
export function loadConfig(configPath: string): Config {
  let text: string;
  try {
    text = fs.readFileSync(configPath, "utf8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    const reason = code === "ENOENT" ? "no such file" : code === "EISDIR" ? "is a directory" : (e as Error).message;
    throw new ConfigError(`cannot read ${configPath}: ${reason}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new ConfigError(`${configPath}: invalid JSON: ${(e as Error).message}`);
  }
  if (!isObject(raw)) throw new ConfigError(`${configPath}: expected a JSON object`);
  return resolveConfig(raw, path.dirname(realPath(configPath)));
}

/** Validate a parsed config, fill in defaults and make every path absolute (relative to BASE). */
export function resolveConfig(raw: Json, base: string): Config {
  // For text values, a missing key and null both mean "use the default".
  function text(obj: Json, key: string, where: string): string | undefined {
    const value = obj[key];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") throw new ConfigError(`${where}${key} must be a string`);
    return value;
  }

  function css(obj: Json, key: string, where: string): string | undefined {
    const value = text(obj, key, where);
    if (value !== undefined && UNSAFE_CSS.test(value)) {
      throw new ConfigError(`${where}${key} is not a plain CSS value: ${JSON.stringify(value)}`);
    }
    return value;
  }

  function file(obj: Json, key: string, where: string, kinds: string[]): string | null {
    const value = text(obj, key, where);
    if (value === undefined) return null;
    const p = realPath(path.resolve(base, value));
    if (!fs.statSync(p, { throwIfNoEntry: false })?.isFile()) throw new ConfigError(`${where}${key}: no such file: ${p}`);
    if (!kinds.includes(path.extname(p).toLowerCase())) {
      throw new ConfigError(`${where}${key} must be one of ${kinds.join(", ")}: ${path.basename(p)}`);
    }
    return p;
  }

  function number(obj: Json, key: string, where: string, def: number, range: [string, string]): number {
    const value = obj[key] === undefined ? def : obj[key];
    if (typeof value !== "number" || !(Number(range[0]) <= value && value <= Number(range[1]))) {
      throw new ConfigError(`${where}${key} must be a number from ${range[0]} to ${range[1]}`);
    }
    return value;
  }

  function section(key: string): Json {
    const value = raw[key] === undefined ? {} : raw[key];
    if (!isObject(value)) throw new ConfigError(`${key} must be an object`);
    return value;
  }

  const name = text(raw, "name", "");
  if (!name) throw new ConfigError("name is required");
  const icon = file(raw, "icon", "", IMAGES);
  if (icon === null) throw new ConfigError("icon is required: a square SVG or PNG app icon");
  let basePath = text(raw, "base_path", "") || "/";
  if (!basePath.endsWith("/")) basePath += "/";
  const siteUrl = text(raw, "site_url", "");

  const m = section("manifest");
  const themeColor = css(m, "theme_color", "manifest.") ?? "#ffffff";
  const manifest: Manifest = {
    shortName: text(m, "short_name", "manifest.") ?? name,
    startUrl: text(m, "start_url", "manifest.") ?? basePath,
    display: text(m, "display", "manifest.") ?? "standalone",
    themeColor,
    backgroundColor: css(m, "background_color", "manifest.") || themeColor,
  };

  const mk = section("maskable");
  const maskable: Maskable = {
    source: file(mk, "source", "maskable.", IMAGES) ?? icon,
    scale: number(mk, "scale", "maskable.", 0.75, ["0.1", "1.0"]),
    background: css(mk, "background", "maskable.") ?? manifest.backgroundColor,
  };

  let share: Share | null = null;
  if (raw.share !== undefined) {
    const s = section("share");
    const template = file(s, "template", "share.", TEMPLATES);
    const shareFile = text(s, "file", "share.") ?? "og-image.png";
    const title = text(s, "title", "share.") ?? name;
    const tagline = text(s, "tagline", "share.") ?? "";
    const alt = text(s, "alt", "share.");
    const mark = file(s, "mark", "share.", IMAGES);
    const background = css(s, "background", "share.") ?? manifest.backgroundColor;
    const glow = css(s, "glow", "share.") ?? null;
    const glowOpacity = number(s, "glow_opacity", "share.", 0.1, ["0.0", "1.0"]);
    const titleColor = css(s, "title_color", "share.") ?? "#111111";
    const taglineColor = css(s, "tagline_color", "share.") || titleColor;
    const titleFont = file(s, "title_font", "share.", FONTS);
    const titleWeight = css(s, "title_weight", "share.") ?? "700";
    const bodyFont = file(s, "body_font", "share.", FONTS);
    if (!shareFile.endsWith(".png") || shareFile.includes("/")) {
      throw new ConfigError("share.file must be a .png file name");
    }
    share = {
      file: shareFile, title, tagline, alt: alt ?? [title, tagline].filter(Boolean).join(" — "),
      mark, template, background, glow, glowOpacity, titleColor, taglineColor, titleFont, titleWeight, bodyFont,
    };
  }

  const favicon = file(raw, "favicon", "", IMAGES) ?? icon;
  const output = realPath(path.resolve(base, text(raw, "output", "") || "."));
  return {
    name, icon, favicon, output, basePath,
    siteUrl: siteUrl ? siteUrl.replace(/\/+$/, "") : null,
    manifest, maskable, share,
  };
}
