// The programmatic API: the same work as the command line, with errors thrown instead of printed.

import { ConfigError, loadConfig, realPath } from "./config.js";
import { generateFiles, headTags, PARTS, type Part } from "./generate.js";
import { findChrome } from "./render.js";

export { ConfigError } from "./config.js";
export { PARTS, type Part } from "./generate.js";
export { RenderError } from "./render.js";

export interface GenerateOptions {
  /** Output directory; default: the config's `output`. Relative paths are relative to the working directory. */
  output?: string;
  /** Generate only these parts; default: all of them. */
  only?: readonly Part[];
  /** Path or name of the Chrome/Chromium/Edge executable; default: $CHROME, then the usual names and locations. */
  chrome?: string;
}

export interface GenerateResult {
  /** The absolute output directory. */
  output: string;
  /** The file names written, sorted. */
  files: string[];
  /** The <head> tags for the generated parts. */
  head: string;
}

/**
 * Render the favicons, app icons, manifest and share image described by the config at CONFIGPATH.
 * Throws ConfigError for a bad config or a missing browser, and RenderError when Chrome fails.
 */
export async function generate(configPath: string, options: GenerateOptions = {}): Promise<GenerateResult> {
  const parts = PARTS.filter((p) => (options.only ?? PARTS).includes(p));
  const cfg = loadConfig(configPath);
  if (options.only?.includes("share") && !cfg.share) {
    throw new ConfigError("only: share needs a share section in the config");
  }
  const output = options.output !== undefined ? realPath(options.output) : cfg.output;
  const files = await generateFiles(cfg, findChrome(options.chrome), output, parts);
  return { output, files, head: headTags(cfg, parts) };
}
