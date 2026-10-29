// Finding the browser, taking screenshots with it, and assembling favicon.ico from PNGs.

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { ConfigError } from "./config.js";
import { fileUrl } from "./format.js";

/** Chrome failed to render an image; the command line prints it and exits with status 1. */
export class RenderError extends Error {
  override name = "RenderError";
}

const CHROME_NAMES = [
  "google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome",
  "chrome-headless-shell", "microsoft-edge", "msedge",
];
const CHROME_APPS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
];
const RENDER_TIMEOUT_S = 60;

function isExecutableFile(p: string): boolean {
  try {
    if (!fs.statSync(p).isFile()) return false;
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Look up a command like `which`: a name with a slash is used as it is, others are searched on $PATH. */
function which(command: string): string | null {
  if (command.includes("/")) return isExecutableFile(command) ? command : null;
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(dir, command);
    if (isExecutableFile(candidate)) return candidate;
  }
  return null;
}

/** The browser to render with: EXPLICIT (--chrome), $CHROME, $CHROME_PATH, then the usual names and app locations. */
export function findChrome(explicit?: string | null): string {
  for (const candidate of [explicit, process.env.CHROME, process.env.CHROME_PATH]) {
    if (candidate) {
      const found = which(candidate);
      if (!found) throw new ConfigError(`Chrome not found or not executable: ${candidate}`);
      return found;
    }
  }
  for (const name of CHROME_NAMES) {
    const found = which(name);
    if (found) return found;
  }
  const app = CHROME_APPS.find(isExecutableFile);
  if (app) return app;
  throw new ConfigError("no Chrome, Chromium or Edge found; install one or pass --chrome PATH");
}

/** The width and height in a PNG's header. */
export function pngSize(data: Buffer): [number, number] {
  if (data.length < 24 || data.toString("latin1", 0, 8) !== "\x89PNG\r\n\x1a\n" || data.toString("latin1", 12, 16) !== "IHDR") {
    throw new Error("not a PNG file");
  }
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

interface Exit {
  code: number | NodeJS.Signals | null;
  output: string;
  timedOut: boolean;
}

/** Seconds Chrome gets to exit by itself after its screenshot is complete. */
const EXIT_GRACE_S = 3;

/** Whether FILE is a complete PNG: it ends with the IEND chunk Chrome writes last. */
export function isCompletePng(file: string): boolean {
  try {
    const data = fs.readFileSync(file);
    return data.length >= 20 && data.toString("latin1", 0, 8) === "\x89PNG\r\n\x1a\n" &&
      data.toString("latin1", data.length - 8, data.length - 4) === "IEND";
  } catch {
    return false;
  }
}

/** Run COMMAND in its own process group, so it can be stopped with its helper processes. If DONE turns true
 *  while it runs, it gets EXIT_GRACE_S to exit and is then stopped and counted as finished: on some Macs
 *  (CI runners in particular) Chrome writes its screenshot and then never exits. */
function run(command: string, args: string[], done?: () => boolean): Promise<Exit> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["inherit", "pipe", "pipe"], detached: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (d: Buffer) => stdout.push(d));
    child.stderr.on("data", (d: Buffer) => stderr.push(d));
    let settled = false;
    let grace: NodeJS.Timeout | undefined;
    const stop = () => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
    const finish = (exit: Exit) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      clearTimeout(grace);
      resolve(exit);
    };
    const timer = setTimeout(() => {
      stop();
      // Stop at the browser's exit: its helper processes may keep the pipes open.
      finish({ code: "SIGKILL", output: "", timedOut: true });
    }, RENDER_TIMEOUT_S * 1000);
    const poll = setInterval(() => {
      if (grace || !done?.()) return;
      grace = setTimeout(() => {
        stop();
        finish({ code: 0, output: "", timedOut: false });
      }, EXIT_GRACE_S * 1000);
    }, 250);
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      clearTimeout(grace);
      reject(e);
    });
    child.on("close", (code, signal) => {
      const err = Buffer.concat(stderr).toString("utf8").trim();
      finish({ code: code ?? signal, output: err || Buffer.concat(stdout).toString("utf8").trim(), timedOut: false });
    });
  });
}

/** Screenshot PAGE at exactly WIDTH x HEIGHT CSS pixels, one pixel each, with a transparent backdrop, into OUT. */
export async function render(chrome: string, page: string, width: number, height: number, out: string, work: string): Promise<void> {
  const name = path.basename(out);
  const htmlFile = path.join(path.dirname(out), path.basename(out, path.extname(out)) + ".html");
  fs.writeFileSync(htmlFile, page);
  const profile = fs.mkdtempSync(path.join(work, "profile-"));
  fs.rmSync(out, { force: true }); // a leftover file would look like a finished screenshot
  const exit = await run(chrome, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", "--disable-extensions", "--mute-audio", "--allow-file-access-from-files",
    `--user-data-dir=${profile}`, "--force-device-scale-factor=1", `--window-size=${width},${height}`,
    "--default-background-color=00000000", "--virtual-time-budget=5000", `--screenshot=${out}`,
    // macOS: keep Chrome away from the login keychain, which can block a headless launch (CI runners, SSH).
    ...(process.platform === "darwin" ? ["--use-mock-keychain"] : []),
    fileUrl(htmlFile),
  ], () => isCompletePng(out));
  if (exit.timedOut) throw new RenderError(`${name}: Chrome did not finish within ${RENDER_TIMEOUT_S} s`);
  if (exit.code !== 0 || !fs.existsSync(out)) {
    const detail = exit.output.split(/\r?\n/).slice(-3).join(" / ");
    throw new RenderError(`${name}: Chrome failed (exit ${exit.code}): ${detail}`);
  }
  const [w, h] = pngSize(fs.readFileSync(out));
  if (w !== width || h !== height) throw new RenderError(`${name}: expected ${width}x${height}, Chrome produced ${w}x${h}`);
}

/** An .ico file whose images are the given PNGs (supported by every current browser and OS). */
export function buildIco(pngs: Buffer[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length + 16 * pngs.length;
  const entries = pngs.map((data) => {
    const [w, h] = pngSize(data);
    if (w > 256 || h > 256) throw new Error("ico images must be at most 256 px");
    const entry = Buffer.alloc(16);
    entry.writeUInt8(w % 256, 0); // 0 means 256
    entry.writeUInt8(h % 256, 1);
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...pngs]);
}
