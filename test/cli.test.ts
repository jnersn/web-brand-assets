import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { HELP, main } from "../src/main.js";
import { VERSION } from "../src/version.js";
import { capture, EXAMPLE_CONFIG, svg, tempDir, write } from "./helpers.js";

async function run(...argv: string[]) {
  const io = capture();
  const code = await main(argv, io);
  return { code, stdout: io.stdout, stderr: io.stderr };
}

function withTemp(fn: (dir: string) => Promise<void>) {
  return async () => {
    const dir = tempDir();
    try {
      await fn(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

const HEAD_MANIFEST = '<link rel="manifest" href="/site.webmanifest" />\n<meta name="theme-color" content="#1d3557" />\n';

test("--help and -h", async () => {
  assert.deepEqual(await run("--help"), { code: 0, stdout: HELP, stderr: "" });
  assert.deepEqual(await run("brand.json", "-h"), { code: 0, stdout: HELP, stderr: "" });
  for (const flag of ["--output", "--only", "--head", "--chrome", "--version", "CONFIG"]) assert.ok(HELP.includes(flag), flag);
});

test("--version", async () => {
  assert.deepEqual(await run("--version"), { code: 0, stdout: `web-brand-assets ${VERSION}\n`, stderr: "" });
  const pkg = JSON.parse(fs.readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"));
  assert.equal(VERSION, pkg.version);
});

test("usage errors exit with status 2", async () => {
  const cases: [string[], RegExp][] = [
    [[], /CONFIG argument is required/],
    [["x", "y"], /unexpected arguments: y/],
    [["x", "--only", "foo"], /invalid --only part 'foo' \(choose from icons, manifest, share\)/],
    [["x", "--bogus"], /--bogus/],
    [["x", "--output"], /--output/],
    [["x", "--head=1"], /--head/],
  ];
  for (const [argv, message] of cases) {
    const result = await run(...argv);
    assert.equal(result.code, 2, argv.join(" "));
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^usage: web-brand-assets CONFIG /);
    assert.match(result.stderr, message, argv.join(" "));
  }
});

test("--head prints the tags and needs no browser", async () => {
  const all = await run(EXAMPLE_CONFIG, "--head", "--chrome", "/nonexistent/chrome");
  assert.equal(all.code, 0);
  assert.ok(all.stdout.includes('<meta property="og:image" content="https://example.com/og-image.png" />'));
  assert.deepEqual(await run(EXAMPLE_CONFIG, "--head", "--only", "manifest"), { code: 0, stdout: HEAD_MANIFEST, stderr: "" });
  assert.deepEqual(await run("--head", "--only=manifest", "--", EXAMPLE_CONFIG), { code: 0, stdout: HEAD_MANIFEST, stderr: "" });
});

test("--only share needs a share section", withTemp(async (dir) => {
  write(path.join(dir, "icon.svg"), svg());
  const config = write(path.join(dir, "brand.json"), '{"name": "A", "icon": "icon.svg"}');
  assert.deepEqual(await run(config, "--only", "share"),
    { code: 1, stdout: "", stderr: "web-brand-assets: --only share needs a share section in the config\n" });
}));

test("config errors exit with status 1", withTemp(async (dir) => {
  const missing = path.join(dir, "missing.json");
  assert.deepEqual(await run(missing), { code: 1, stdout: "", stderr: `web-brand-assets: cannot read ${missing}: no such file\n` });
  const bad = write(path.join(dir, "bad.json"), '{"name": "A",}');
  const result = await run(bad, "--head");
  assert.equal(result.code, 1);
  assert.ok(result.stderr.startsWith(`web-brand-assets: ${bad}: invalid JSON: `));
  write(path.join(dir, "icon.svg"), svg());
  const invalid = write(path.join(dir, "brand.json"), '{"name": "A", "icon": "icon.svg", "maskable": {"scale": 2}}');
  assert.deepEqual(await run(invalid, "--head"),
    { code: 1, stdout: "", stderr: "web-brand-assets: maskable.scale must be a number from 0.1 to 1.0\n" });
}));

test("a missing browser exits with status 1", async () => {
  assert.deepEqual(await run(EXAMPLE_CONFIG, "--chrome", "/nonexistent/chrome"),
    { code: 1, stdout: "", stderr: "web-brand-assets: Chrome not found or not executable: /nonexistent/chrome\n" });
});

test("a failing browser is reported with its last lines of output, and nothing is written", withTemp(async (dir) => {
  const chrome = path.join(dir, "chrome");
  fs.writeFileSync(chrome, "#!/bin/sh\necho one >&2\necho two >&2\necho three >&2\necho four >&2\nexit 3\n", { mode: 0o755 });
  const result = await run(EXAMPLE_CONFIG, "--chrome", chrome, "--output", path.join(dir, "out"));
  assert.deepEqual(result, { code: 1, stdout: "", stderr: "web-brand-assets: ico-16.png: Chrome failed (exit 3): two / three / four\n" });
  assert.ok(!fs.existsSync(path.join(dir, "out")));
}));

test("a browser that writes no screenshot is reported", withTemp(async (dir) => {
  const result = await run(EXAMPLE_CONFIG, "--only", "icons", "--chrome", "true", "--output", path.join(dir, "out"));
  assert.deepEqual(result, { code: 1, stdout: "", stderr: "web-brand-assets: ico-16.png: Chrome failed (exit 0): \n" });
}));

test("--only manifest renders nothing", withTemp(async (dir) => {
  const out = path.join(dir, "out");
  const result = await run(EXAMPLE_CONFIG, "--only", "manifest", "--chrome", "true", "--output", out);
  assert.deepEqual(result, {
    code: 0,
    stdout: `wrote 1 file to ${fs.realpathSync(out)}:\n  site.webmanifest\n\nAdd to <head>:\n${HEAD_MANIFEST}`,
    stderr: "",
  });
}));

test("the bin runs", () => {
  const cli = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));
  if (!fs.existsSync(cli)) return;
  assert.equal(execFileSync(cli, ["--version"], { encoding: "utf8" }), `web-brand-assets ${VERSION}\n`);
  const result = spawnSync(cli, [], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /CONFIG argument is required/);
});
