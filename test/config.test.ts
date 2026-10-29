import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { ConfigError, loadConfig, resolveConfig } from "../src/config.js";
import { svg, tempDir, write } from "./helpers.js";

describe("config", () => {
  let base: string;

  beforeEach(() => {
    base = fs.realpathSync(tempDir());
    write(path.join(base, "logo/icon.svg"), svg());
  });

  afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

  const resolve = (raw: Record<string, unknown> = {}) => resolveConfig({ name: "Acme", icon: "logo/icon.svg", ...raw }, base);

  test("defaults", () => {
    const cfg = resolve({ manifest: { theme_color: "#abcdef" } });
    const icon = path.join(base, "logo/icon.svg");
    assert.equal(cfg.icon, icon);
    assert.equal(cfg.favicon, icon);
    assert.equal(cfg.output, base);
    assert.equal(cfg.basePath, "/");
    assert.equal(cfg.manifest.shortName, "Acme");
    assert.equal(cfg.manifest.backgroundColor, "#abcdef");
    assert.deepEqual(cfg.maskable, { source: icon, scale: 0.75, background: "#abcdef" });
    assert.equal(cfg.share, null);
  });

  test("share defaults", () => {
    const share = resolve({ share: { tagline: "Tools." } }).share!;
    assert.equal(share.file, "og-image.png");
    assert.equal(share.title, "Acme");
    assert.equal(share.alt, "Acme — Tools.");
    assert.equal(share.taglineColor, share.titleColor);
  });

  test("base_path and site_url are normalised", () => {
    const cfg = resolve({ base_path: "/app", site_url: "https://example.com/" });
    assert.equal(cfg.basePath, "/app/");
    assert.equal(cfg.siteUrl, "https://example.com");
    assert.equal(cfg.manifest.startUrl, "/app/");
  });

  test("paths are resolved relative to the config, through symlinks", () => {
    fs.symlinkSync(path.join(base, "logo"), path.join(base, "link"));
    const cfg = resolve({ icon: "link/../logo/./icon.svg", output: "link/out" });
    assert.equal(cfg.icon, path.join(base, "logo/icon.svg"));
    assert.equal(cfg.output, path.join(base, "logo/out"));
    assert.equal(resolve({ output: "" }).output, base);
  });

  test("errors", () => {
    write(path.join(base, "logo/icon.gif"), "x");
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ name: "" }, /^name is required$/],
      [{ name: 3 }, /^name must be a string$/],
      [{ icon: null }, /^icon is required/],
      [{ icon: "logo/missing.svg" }, /^icon: no such file: .*\/logo\/missing\.svg$/],
      [{ icon: "logo" }, /^icon: no such file/],
      [{ icon: "logo/icon.gif" }, /^icon must be one of \.svg, \.png: icon\.gif$/],
      [{ manifest: { theme_color: "red;}body{x:y" } }, /^manifest\.theme_color is not a plain CSS value: "red;}body{x:y"$/],
      [{ manifest: { theme_color: 3 } }, /^manifest\.theme_color must be a string$/],
      [{ maskable: { scale: 2 } }, /^maskable\.scale must be a number from 0\.1 to 1\.0$/],
      [{ maskable: { scale: true } }, /number from/],
      [{ maskable: { scale: null } }, /number from/],
      [{ maskable: { scale: "1" } }, /number from/],
      [{ maskable: { source: "logo/icon.gif" } }, /^maskable\.source must be one of/],
      [{ share: { file: 1 } }, /^share\.file must be a string$/],
      [{ share: { glow_opacity: 2 } }, /^share\.glow_opacity must be a number from 0\.0 to 1\.0$/],
      [{ share: { file: "../og.png" } }, /^share\.file must be a \.png file name$/],
      [{ share: { file: "og.jpg" } }, /share\.file/],
      [{ share: { title_font: "logo/icon.svg" } }, /^share\.title_font must be one of \.woff2, \.woff, \.ttf, \.otf: icon\.svg$/],
      [{ share: { template: "logo/icon.svg" } }, /^share\.template must be one of \.html, \.htm: icon\.svg$/],
      [{ manifest: [] }, /^manifest must be an object$/],
      [{ share: null }, /^share must be an object$/],
      [{ favicon: "logo/missing.svg", output: 3 }, /^favicon: no such file/],
      [{ output: 3 }, /^output must be a string$/],
    ];
    for (const [raw, message] of cases) {
      assert.throws(() => resolve(raw), (e: unknown) => e instanceof ConfigError && message.test(e.message), JSON.stringify(raw));
    }
  });

  test("validation order follows the config's sections", () => {
    // The icon is checked before the manifest, the share section before the favicon and the output.
    assert.throws(() => resolve({ icon: "nope.svg", manifest: [] }), /icon: no such file/);
    assert.throws(() => resolve({ favicon: "nope.svg", share: { file: "x.jpg" } }), /share\.file/);
  });

  test("null text values and empty colours fall back to the defaults", () => {
    const cfg = resolve({ manifest: { short_name: null, background_color: "" }, share: { alt: null, title: "" } });
    assert.equal(cfg.manifest.shortName, "Acme");
    assert.equal(cfg.manifest.backgroundColor, "#ffffff");
    assert.equal(cfg.share!.alt, "");
  });

  test("loadConfig reports bad JSON", () => {
    const file = write(path.join(base, "brand.json"), "{");
    assert.throws(() => loadConfig(file), (e: unknown) => e instanceof ConfigError && e.message.startsWith(`${file}: invalid JSON: `));
    assert.throws(() => loadConfig(path.join(base, "missing.json")), {
      message: `cannot read ${path.join(base, "missing.json")}: no such file`,
    });
    assert.throws(() => loadConfig(base), { message: `cannot read ${base}: is a directory` });
    write(path.join(base, "list.json"), "[]");
    assert.throws(() => loadConfig(path.join(base, "list.json")), /list\.json: expected a JSON object$/);
  });

  test("loadConfig resolves paths next to the config", () => {
    const file = write(path.join(base, "sub/brand.json"), '{"name": "A", "icon": "../logo/icon.svg", "output": "out"}');
    const cfg = loadConfig(file);
    assert.equal(cfg.icon, path.join(base, "logo/icon.svg"));
    assert.equal(cfg.output, path.join(base, "sub/out"));
  });
});
