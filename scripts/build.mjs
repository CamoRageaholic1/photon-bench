import { cpSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { resolveBuildOutput } from "./build-paths.mjs";

const root = resolve(import.meta.dirname, "..");
const output = resolveBuildOutput(root, process.env.BUILD_DIR);
const required = ["index.html", "src", "_headers"];

for (const entry of required) {
  if (!existsSync(resolve(root, entry))) {
    throw new Error(`Missing required build input: ${entry}`);
  }
}

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
cpSync(resolve(root, "index.html"), resolve(output, "index.html"));
cpSync(resolve(root, "src"), resolve(output, "src"), { recursive: true });
cpSync(resolve(root, "_headers"), resolve(output, "_headers"));

const assetCount = ["index.html", "_headers", "src/main.js", "src/styles.css"].filter(
  (entry) => statSync(resolve(output, entry)).isFile(),
).length;

if (assetCount !== 4) {
  throw new Error("Build verification failed: expected deploy assets are missing.");
}

console.log(`Photon Bench build ready: ${output}`);
