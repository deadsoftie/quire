import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const rootPackageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const version = rootPackageJson.version;

if (!version) {
  console.error("sync-version: root package.json has no \"version\" field");
  process.exit(1);
}

function replaceOrExit(filePath, relativePath, pattern, replacement, notFoundLabel) {
  const text = readFileSync(filePath, "utf8");
  if (!pattern.test(text)) {
    console.error(`sync-version: no ${notFoundLabel} found in ${relativePath}`);
    process.exit(1);
  }
  writeFileSync(filePath, text.replace(pattern, replacement));
}

function setPackageJsonVersion(relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  replaceOrExit(filePath, relativePath, /^(\s*"version"\s*:\s*)"[^"]*"/m, `$1"${version}"`, '"version" field');
}

function setCargoWorkspaceVersion(relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  replaceOrExit(filePath, relativePath, /^version\s*=\s*"[^"]*"/m, `version = "${version}"`, "workspace version line");
}

for (const relativePath of [
  "apps/desktop/package.json",
  "packages/ui/package.json",
  "packages/design/package.json",
  "packages/client/package.json",
]) {
  setPackageJsonVersion(relativePath);
}

setCargoWorkspaceVersion("Cargo.toml");

console.log(`sync-version: synced ${version} to all packages and Cargo.toml`);
