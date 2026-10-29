import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { beforeEach, describe, test } from "node:test";
import { ConfigError, loadConfig, type Config } from "../src/config.js";
import { escapeHtml, fileUrl, formatDecimal, roundHalfEven, roundTo2 } from "../src/format.js";
import { headTags, manifestJson, plan } from "../src/generate.js";
import { iconPage, sharePage, templatePage } from "../src/pages.js";
import { buildIco, findChrome, pngSize } from "../src/render.js";
import { EXAMPLE_CONFIG, png, tempDir, write } from "./helpers.js";

describe("outputs", () => {
  let cfg: Config;

  beforeEach(() => {
    cfg = loadConfig(EXAMPLE_CONFIG);
  });

  test("buildIco", () => {
    const images = [png(16, 16), png(32, 32), png(256, 256)];
    const ico = buildIco(images);
    assert.deepEqual([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)], [0, 1, 3]);
    images.forEach((data, i) => {
      const e = 6 + 16 * i;
      const size = ico.readUInt32LE(e + 8);
      const offset = ico.readUInt32LE(e + 12);
      const expected = [16, 32, 0][i];
      assert.deepEqual([ico[e], ico[e + 1], ico.readUInt16LE(e + 4), ico.readUInt16LE(e + 6), size], [expected, expected, 1, 32, data.length]);
      assert.deepEqual(ico.subarray(offset, offset + size), data);
    });
    assert.throws(() => buildIco([png(512, 512)]), /at most 256 px/);
  });

  test("pngSize", () => {
    assert.deepEqual(pngSize(png(7, 9)), [7, 9]);
    assert.throws(() => pngSize(Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(30)])), /not a PNG file/);
  });

  test("manifest", () => {
    cfg.basePath = "/app/";
    const text = manifestJson(cfg);
    const data = JSON.parse(text);
    assert.equal(data.name, "Example Peaks");
    assert.equal(data.short_name, "Peaks");
    assert.deepEqual(data.icons.map((i: { src: string }) => i.src), ["/app/icon-192.png", "/app/icon-512.png", "/app/icon-maskable-512.png"]);
    assert.equal(data.icons[2].purpose, "maskable");
    assert.equal(data.theme_color, "#1d3557");
    // Two-space indentation, non-ASCII kept as it is, and a final newline.
    assert.deepEqual(Object.keys(data), ["name", "short_name", "icons", "start_url", "display", "theme_color", "background_color"]);
    assert.ok(text.startsWith('{\n  "name": "Example Peaks",\n  "short_name": "Peaks",\n  "icons": [\n    {\n      "src": "/app/icon-192.png",'));
    assert.ok(text.endsWith('"background_color": "#1d3557"\n}\n'));
    cfg.name = "Åå \"q\" \u0001";
    assert.ok(manifestJson(cfg).includes('"name": "Åå \\"q\\" \\u0001"'));
  });

  test("head tags", () => {
    const tags = headTags(cfg);
    assert.ok(tags.includes('<link rel="icon" href="/favicon.svg" type="image/svg+xml" />'));
    assert.ok(tags.includes('<meta property="og:image" content="https://example.com/og-image.png" />'));
    assert.ok(tags.includes('content="Example Peaks — Small tools for big hikes."'));
    assert.ok(!headTags(cfg, ["icons", "manifest"]).includes("og:image"));
    assert.equal(headTags(cfg, ["manifest"]), '<link rel="manifest" href="/site.webmanifest" />\n<meta name="theme-color" content="#1d3557" />');
  });

  test("head tags without an SVG favicon or site_url", () => {
    cfg.favicon = "favicon.png";
    cfg.siteUrl = null;
    cfg.share!.alt = 'A "quoted" <alt>';
    const tags = headTags(cfg);
    assert.ok(!tags.includes("favicon.svg"));
    assert.ok(tags.includes("set site_url"));
    assert.ok(tags.includes('content="/og-image.png"'));
    assert.ok(tags.includes("A &quot;quoted&quot; &lt;alt&gt;"));
  });

  test("icon page", () => {
    const page = iconPage("/a b/ä.svg", 512, 0.333, "red");
    assert.equal(page, '<!doctype html><html><head><meta charset="utf-8"><style>' +
      "html,body{margin:0;width:512px;height:512px;overflow:hidden;background:red}" +
      "body{display:flex;align-items:center;justify-content:center}img{display:block;width:170px;height:170px}" +
      '</style></head><body><img src="file:///a%20b/%C3%A4.svg" alt=""></body></html>');
    // Halves round to even.
    assert.ok(iconPage("/i.svg", 5, 0.5).includes("width:2px"));
    assert.ok(iconPage("/i.svg", 7, 0.5).includes("width:4px"));
  });

  test("share page escapes text", () => {
    const share = { ...cfg.share!, title: "<script>x</script>", tagline: "A & B" };
    const page = sharePage(share);
    assert.ok(page.includes("&lt;script&gt;x&lt;/script&gt;"));
    assert.ok(page.includes("<p>A &amp; B</p>"));
    assert.ok(!page.includes("@font-face"));
    assert.ok(page.includes("color-mix(in srgb, #a8dadc 10.0%, transparent)"));
    assert.ok(sharePage({ ...share, glow: null }).includes("background-image:none"));
    assert.ok(!sharePage({ ...share, tagline: "" }).includes("<p>"));
    assert.ok(sharePage({ ...share, glowOpacity: 0.07 }).includes(" 7.0%"));
    assert.ok(sharePage({ ...share, glowOpacity: 0.12345 }).includes(" 12.35%"));
  });

  test("share page fonts", () => {
    const tmp = tempDir();
    try {
      const font = write(path.join(tmp, "Title Font.woff2"), "x");
      const page = sharePage({ ...cfg.share!, titleFont: font });
      assert.ok(page.includes('font-family:"Brand Title"'));
      assert.ok(page.includes('format("woff2")'));
      assert.ok(page.includes("Title%20Font.woff2"));
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  test("template page", () => {
    const tmp = tempDir();
    try {
      const template = write(path.join(tmp, "share.html"),
        "<html><HEAD><title>{{ name }}</title></HEAD>\r\n<body>{{title}} {{tagline}}</body></html>");
      const values = { title: "A<B", tagline: "", name: "N&co" };
      const page = templatePage(template, values);
      assert.ok(page.includes(`<HEAD><base href="${fileUrl(tmp)}/"><title>N&amp;co</title>`));
      assert.ok(page.includes("</HEAD>\n<body>A&lt;B </body>"), "line endings are normalised");
      const bare = write(path.join(tmp, "bare.html"), "<p>{{title}}</p>");
      assert.ok(templatePage(bare, values).startsWith("<base href="));
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  test("plan", () => {
    const names = plan(cfg, ["icons", "manifest", "share"]).map((job) => job.file);
    assert.deepEqual(names, ["ico-16.png", "ico-32.png", "ico-48.png", "favicon-96x96.png", "apple-touch-icon.png",
      "icon-192.png", "icon-512.png", "icon-maskable-512.png", "og-image.png"]);
    assert.deepEqual(plan(cfg, ["manifest"]), []);
  });

  test("findChrome with a missing explicit browser", () => {
    assert.throws(() => findChrome("/nonexistent/chrome"), (e: unknown) => e instanceof ConfigError && /not found/.test(e.message));
  });

  test("findChrome honours $CHROME", () => {
    const saved = process.env.CHROME;
    try {
      process.env.CHROME = "/nonexistent/env-chrome";
      assert.throws(() => findChrome(), { message: "Chrome not found or not executable: /nonexistent/env-chrome" });
      process.env.CHROME = process.execPath;
      assert.equal(findChrome(), process.execPath);
      assert.match(findChrome("node"), /\/node$/);
      assert.throws(() => findChrome("no-such-browser-here"), /not found/);
    } finally {
      if (saved === undefined) delete process.env.CHROME;
      else process.env.CHROME = saved;
    }
  });

  test("formatting", () => {
    assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#x27;&amp;&#x27;&lt;/a&gt;");
    assert.equal(fileUrl("/a b/ä!(x)+,;=@.svg"), "file:///a%20b/%C3%A4%21%28x%29%2B%2C%3B%3D%40.svg");
    assert.deepEqual([0.5, 1.5, 2.5, 2.4, 2.6].map(roundHalfEven), [0, 2, 2, 2, 3]);
    assert.deepEqual([12.5, 12.345, 0.125, 0.375, 7.000000000000001].map(roundTo2), [12.5, 12.35, 0.12, 0.38, 7]);
    assert.deepEqual([10, 0, 12.35].map(formatDecimal), ["10.0", "0.0", "12.35"]);
  });
});
