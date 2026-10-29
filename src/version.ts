import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/** The package version, read from the nearest package.json above this file. */
function readVersion(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
      if (pkg.name === "web-brand-assets") return pkg.version;
    } catch {
      // keep looking
    }
    const parent = path.dirname(dir);
    if (parent === dir) return "unknown";
    dir = parent;
  }
}

export const VERSION = readVersion();
