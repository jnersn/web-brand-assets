// The command line.

import { parseArgs } from "node:util";
import { ConfigError, loadConfig, realPath } from "./config.js";
import { generateFiles, headTags, PARTS, type Part } from "./generate.js";
import { findChrome, RenderError } from "./render.js";
import { VERSION } from "./version.js";

const USAGE = "usage: web-brand-assets CONFIG [--output DIR] [--only PART]... [--head] [--chrome PATH]\n";

export const HELP = `${USAGE}
Generate a website's favicons, app icons, web app manifest and share image
from its logo files.

arguments:
  CONFIG          the brand config (JSON); paths in it are relative to it

options:
  --output DIR    output directory (default: the config's output)
  --only PART     generate only this part: icons, manifest or share (repeatable)
  --head          print the <head> tags and exit; render nothing
  --chrome PATH   path or name of the Chrome/Chromium/Edge executable
                  (default: $CHROME, then the usual names and locations)
  -h, --help      show this help and exit
  --version       show the version and exit
`;

export interface Output {
  out(text: string): void;
  err(text: string): void;
}

const processOutput: Output = {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
};

class UsageError extends Error {}

function parse(argv: string[]) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        output: { type: "string" },
        only: { type: "string", multiple: true },
        head: { type: "boolean" },
        chrome: { type: "string" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean" },
      },
    });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code?.startsWith("ERR_PARSE_ARGS")) throw new UsageError((e as Error).message);
    throw e;
  }
  const { values, positionals } = parsed;
  if (values.help || values.version) return { ...values, config: "" };
  for (const part of values.only ?? []) {
    if (!(PARTS as readonly string[]).includes(part)) {
      throw new UsageError(`invalid --only part '${part}' (choose from ${PARTS.join(", ")})`);
    }
  }
  if (positionals.length === 0) throw new UsageError("the CONFIG argument is required");
  if (positionals.length > 1) throw new UsageError(`unexpected arguments: ${positionals.slice(1).join(" ")}`);
  return { ...values, only: values.only as Part[] | undefined, config: positionals[0] };
}

/** Run the command line with ARGV (without the program name); resolves to the exit status. */
export async function main(argv: string[], io: Output = processOutput): Promise<number> {
  let args: ReturnType<typeof parse>;
  try {
    args = parse(argv);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    io.err(`${USAGE}web-brand-assets: error: ${e.message}\n`);
    return 2;
  }
  if (args.help) {
    io.out(HELP);
    return 0;
  }
  if (args.version) {
    io.out(`web-brand-assets ${VERSION}\n`);
    return 0;
  }

  const parts = PARTS.filter((p) => (args.only ?? PARTS).includes(p));
  try {
    const cfg = loadConfig(args.config);
    if (args.only?.includes("share") && !cfg.share) {
      throw new ConfigError("--only share needs a share section in the config");
    }
    if (args.head) {
      io.out(headTags(cfg, parts) + "\n");
      return 0;
    }
    const output = args.output !== undefined ? realPath(args.output) : cfg.output;
    const written = await generateFiles(cfg, findChrome(args.chrome), output, parts);
    io.out(`wrote ${written.length} file${written.length === 1 ? "" : "s"} to ${output}:\n`);
    for (const name of written) io.out(`  ${name}\n`);
    io.out("\nAdd to <head>:\n" + headTags(cfg, parts) + "\n");
    return 0;
  } catch (e) {
    if (e instanceof ConfigError || e instanceof RenderError) {
      io.err(`web-brand-assets: ${e.message}\n`);
      return 1;
    }
    throw e;
  }
}
