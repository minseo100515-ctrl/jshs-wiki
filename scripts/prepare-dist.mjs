import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");

const staticFiles = [
  "index.html",
  "style.css",
  "app.js",
  "auth.js",
  "api.js",
  "gen-calendar.js",
  "mock-data.js",
  "config.js",
];

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

for (const file of staticFiles) {
  fs.copyFileSync(path.join(rootDir, file), path.join(distDir, file));
}

console.log(`Prepared dist/ with ${staticFiles.length} files.`);
