/* global console */
import { gzipSync } from "node:zlib";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { URL } from "node:url";

const MAX_INITIAL_GZIP_BYTES = 150 * 1024;
const assetsDirectory = new URL("../dist/assets/", import.meta.url);
const entries = await readdir(assetsDirectory);
const entryFiles = entries.filter((name) => /^index-[^.]+\.js$/.test(name));

if (entryFiles.length !== 1) {
  throw new Error(`Expected one initial JavaScript entry, found ${entryFiles.length}`);
}

const entryPath = join(assetsDirectory.pathname, entryFiles[0]);
const bytes = await readFile(entryPath);
const gzipBytes = gzipSync(bytes).byteLength;
const kib = (gzipBytes / 1024).toFixed(1);

if (gzipBytes > MAX_INITIAL_GZIP_BYTES) {
  throw new Error(`Initial JavaScript is ${kib} KiB gzip; budget is 150 KiB`);
}

console.log(`Initial JavaScript: ${kib} KiB gzip (budget: 150 KiB)`);
