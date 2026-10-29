import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { after, before, describe, test } from "node:test";
import { loadConfig, type Config } from "../src/config.js";
import { generateFiles } from "../src/generate.js";
import { isCompletePng, pngSize, render } from "../src/render.js";
import { generate } from "../src/index.js";
import { CHROME, EXAMPLE_CONFIG, pixels, png, tempDir, write } from "./helpers.js";

describe("render", { skip: CHROME ? false : "no Chrome, Chromium or Edge installed" }, () => {
  let tmp: string;
  let out: string;
  let cfg: Config;
  let written: string[];

  before(async () => {
    tmp = tempDir();
    out = path.join(tmp, "out");
    cfg = loadConfig(EXAMPLE_CONFIG);
    written = await generateFiles(cfg, CHROME as string, out);
  });

  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  test("files", () => {
    const expected = ["apple-touch-icon.png", "favicon-96x96.png", "favicon.ico", "favicon.svg", "icon-192.png",
      "icon-512.png", "icon-maskable-512.png", "og-image.png", "site.webmanifest"];
    assert.deepEqual(written, expected);
    assert.deepEqual(fs.readdirSync(out).sort(), expected);
  });

  test("sizes", () => {
    const expected: Record<string, number> = { "favicon-96x96.png": 96, "apple-touch-icon.png": 180, "icon-192.png": 192, "icon-512.png": 512, "icon-maskable-512.png": 512 };
    for (const [name, size] of Object.entries(expected)) assert.deepEqual(pngSize(fs.readFileSync(path.join(out, name))), [size, size], name);
    assert.deepEqual(pngSize(fs.readFileSync(path.join(out, "og-image.png"))), [1200, 630]);
  });

  test("ico", () => {
    const ico = fs.readFileSync(path.join(out, "favicon.ico"));
    const count = ico.readUInt16LE(4);
    assert.deepEqual(Array.from({ length: count }, (_, i) => ico[6 + 16 * i]), [16, 32, 48]);
  });

  test("pixels", () => {
    const navy = [0x1d, 0x35, 0x57, 255];
    const rounded = pixels(path.join(out, "favicon-96x96.png"));
    assert.equal(rounded[0][0][3], 0, "rounded favicon keeps transparent corners");
    assert.deepEqual(rounded[48][4], navy);
    assert.deepEqual(pixels(path.join(out, "apple-touch-icon.png"))[0][0], navy);
    const maskable = pixels(path.join(out, "icon-maskable-512.png"));
    assert.deepEqual(maskable[0][0], navy, "maskable padding uses the background colour");
    assert.equal(maskable[256][256][3], 255);
    assert.deepEqual(pixels(path.join(out, "og-image.png"))[620][10], navy);
  });

  test("custom template", async () => {
    const dir = tempDir();
    try {
      write(path.join(dir, "style.css"), "body{margin:0;background:#00ff00}");
      const template = write(path.join(dir, "share.html"), '<html><head><link rel="stylesheet" href="style.css"></head><body>{{title}}</body></html>');
      await generateFiles({ ...cfg, share: { ...cfg.share!, template } }, CHROME as string, path.join(dir, "out"), ["share"]);
      assert.deepEqual(pixels(path.join(dir, "out/og-image.png"))[600][1100], [0, 255, 0, 255]);
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });

  test("generate API", async () => {
    const dir = tempDir();
    try {
      const result = await generate(EXAMPLE_CONFIG, { output: path.join(dir, "api"), only: ["icons", "manifest"], chrome: CHROME as string });
      assert.equal(result.output, path.join(fs.realpathSync(dir), "api"));
      assert.deepEqual(result.files, ["apple-touch-icon.png", "favicon-96x96.png", "favicon.ico", "favicon.svg", "icon-192.png",
        "icon-512.png", "icon-maskable-512.png", "site.webmanifest"]);
      assert.ok(!result.head.includes("og:image"));
      for (const name of result.files) assert.deepEqual(fs.readFileSync(path.join(result.output, name)), fs.readFileSync(path.join(out, name)), name);
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });
});

/** A PNG header followed by the IEND chunk that ends every complete PNG. */
const completePng = (width: number, height: number) =>
  Buffer.concat([png(width, height), Buffer.from("0000000049454e44ae426082", "hex")]);

test("a browser that writes its screenshot and never exits is stopped", async () => {
  const dir = tempDir();
  try {
    // Like Chrome on some Macs: write the screenshot, then keep running.
    const shot = path.join(dir, "shot.png");
    fs.writeFileSync(shot, completePng(16, 16));
    const browser = write(path.join(dir, "browser.sh"),
      `#!/bin/sh\nfor a; do case $a in --screenshot=*) cp '${shot}' "\${a#--screenshot=}";; esac; done\nexec sleep 120\n`);
    fs.chmodSync(browser, 0o755);
    const out = path.join(dir, "icon.png");
    const started = Date.now();
    await render(browser, "<html></html>", 16, 16, out, dir);
    assert.ok(Date.now() - started < 10_000);
    assert.deepEqual(fs.readFileSync(out), fs.readFileSync(shot));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("isCompletePng", () => {
  const dir = tempDir();
  try {
    const whole = completePng(4, 4);
    assert.equal(isCompletePng(write(path.join(dir, "a.png"), "")), false);
    fs.writeFileSync(path.join(dir, "b.png"), whole.subarray(0, whole.length - 6));
    assert.equal(isCompletePng(path.join(dir, "b.png")), false);
    fs.writeFileSync(path.join(dir, "c.png"), whole);
    assert.equal(isCompletePng(path.join(dir, "c.png")), true);
    assert.equal(isCompletePng(path.join(dir, "missing.png")), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
