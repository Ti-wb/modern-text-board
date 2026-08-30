/* global console */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, URL } from "node:url";

const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const EXPECTED_FONT_STYLES = 9;
const projectDirectory = fileURLToPath(new URL("../", import.meta.url));
const distDirectory = join(projectDirectory, "dist");

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  }));
  return nested.flat();
}

const files = await listFiles(distDirectory);
if (files.length >= MAX_FILES) {
  throw new Error(`Build has ${files.length} files; limit is below ${MAX_FILES}`);
}

for (const path of files) {
  const info = await stat(path);
  if (info.size >= MAX_FILE_BYTES) {
    throw new Error(
      `${relative(distDirectory, path)} is ${(info.size / 1024 / 1024).toFixed(1)} MiB; limit is below 25 MiB`,
    );
  }
}

const relativeFiles = files.map((path) =>
  relative(distDirectory, path).replaceAll("\\", "/"),
);
const fontStyles = relativeFiles.filter((path) =>
  /^assets\/font-[^/]+\.css$/.test(path),
);
if (fontStyles.length !== EXPECTED_FONT_STYLES) {
  throw new Error(
    `Expected ${EXPECTED_FONT_STYLES} optional font CSS chunks, found ${fontStyles.length}`,
  );
}

const legacyWoff = relativeFiles.filter((path) => path.endsWith(".woff"));
if (legacyWoff.length > 0) {
  throw new Error(`Legacy WOFF assets were emitted: ${legacyWoff.join(", ")}`);
}

const thirdPartyFontHost = /fonts\.(?:googleapis|gstatic)\.com/i;
for (const path of files.filter((candidate) => /\.(?:css|html|js)$/.test(candidate))) {
  const source = await readFile(path, "utf8");
  if (thirdPartyFontHost.test(source)) {
    throw new Error(
      `Third-party font host found in ${relative(distDirectory, path)}`,
    );
  }
}

const html = await readFile(join(distDirectory, "index.html"), "utf8");
for (const path of fontStyles) {
  if (html.includes(path.split("/").at(-1))) {
    throw new Error(`${path} is linked by the initial HTML`);
  }
}

const serviceWorker = await readFile(join(distDirectory, "sw.js"), "utf8");
for (const path of fontStyles) {
  if (serviceWorker.includes(`url:"${path}"`)) {
    throw new Error(`${path} is present in the service worker precache`);
  }
}
if (/url:"assets\/[^"]+\.woff2"/.test(serviceWorker)) {
  throw new Error("WOFF2 assets are present in the service worker precache");
}
if (!serviceWorker.includes("optional-web-fonts-v1")) {
  throw new Error("Optional font runtime cache is missing from the service worker");
}

const fontLicenses = relativeFiles.filter((path) =>
  /^licenses\/fonts\/(?!OFL-1\.1\.txt$)[^/]+\.txt$/.test(path),
);
if (fontLicenses.length !== EXPECTED_FONT_STYLES) {
  throw new Error(
    `Expected ${EXPECTED_FONT_STYLES} per-font notices, found ${fontLicenses.length}`,
  );
}
if (!relativeFiles.includes("licenses/fonts/OFL-1.1.txt")) {
  throw new Error("The SIL OFL-1.1 license text is missing from the build");
}

console.log(
  `Optional fonts: ${fontStyles.length} lazy CSS chunks, ${relativeFiles.filter((path) => path.endsWith(".woff2")).length} WOFF2 assets, ${files.length} total files`,
);
