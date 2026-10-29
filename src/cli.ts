#!/usr/bin/env node
// web-brand-assets CONFIG: generate a website's favicons, app icons, web app manifest and share image
// from its logo files. Run with --help for the options.

import { main } from "./main.js";

process.exitCode = await main(process.argv.slice(2));
