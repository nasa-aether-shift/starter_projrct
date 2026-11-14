#!/usr/bin/env node
// Copies Cesium's static runtime folders into public/cesium (served at /cesium).
// window.CESIUM_BASE_URL = "/cesium" must be set before Cesium is imported (see lib/cesium/load.ts).
// Runs on postinstall, so Vercel and fresh clones get the files automatically. public/cesium is gitignored.
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cesiumPkg = require.resolve("cesium/package.json", { paths: [root] });
const version = JSON.parse(readFileSync(cesiumPkg, "utf8")).version;
const src = join(dirname(cesiumPkg), "Build", "Cesium");
const dest = join(root, "public", "cesium");
const stamp = join(dest, ".version");

if (existsSync(stamp) && readFileSync(stamp, "utf8") === version) {
  console.log(`cesium ${version} assets already in public/cesium`);
  process.exit(0);
}
rmSync(dest, { recursive: true, force: true });
for (const dir of ["Workers", "Assets", "Widgets", "ThirdParty"])
  cpSync(join(src, dir), join(dest, dir), { recursive: true });
writeFileSync(stamp, version);
console.log(`copied cesium ${version} assets to public/cesium`);
