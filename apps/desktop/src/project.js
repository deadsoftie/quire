const fs = require("node:fs");
const path = require("node:path");

const SKIP_NAMES = new Set([".git", ".quire", "node_modules"]);

function walkTexFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_NAMES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkTexFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".tex")) {
      results.push(full);
    }
  }
  return results;
}

// M0 spike: real root detection (spec Section 9.4 / task 1.2 -- explicit
// `% !TEX root`, then `\documentclass`, then most-included file, else
// ambiguous) is an M1 concern. For now: prefer `main.tex`, else the first
// `.tex` file that declares a `\documentclass`.
function findRootTexFile(projectRoot) {
  const candidateMain = path.join(projectRoot, "main.tex");
  if (fs.existsSync(candidateMain)) return candidateMain;

  const texFiles = walkTexFiles(projectRoot);
  const withDocumentclass = texFiles.find((file) =>
    fs.readFileSync(file, "utf8").includes("\\documentclass"),
  );
  return withDocumentclass ?? texFiles[0] ?? null;
}

// fs.cpSync refuses outright when dest is inside src, regardless of any
// filter -- so the top-level `.quire` entry has to be skipped by our own
// walk (never even naming it in a cpSync call) rather than filtered out
// from within one.
function copyDirExcluding(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP_NAMES.has(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirExcluding(from, to);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
    }
  }
}

// Mirrors the project into `<projectRoot>/.quire/build/` so support files
// (images, .bib, sub-.tex files) are available to the compiler via cwd,
// without ever writing into the real project folder. Dirty (unsaved)
// buffer contents get written into this shadow copy per-compile, never
// into the source tree itself.
function mirrorProjectToShadow(projectRoot) {
  const shadowDir = path.join(projectRoot, ".quire", "build");
  fs.rmSync(shadowDir, { recursive: true, force: true });
  copyDirExcluding(projectRoot, shadowDir);
  return shadowDir;
}

module.exports = { findRootTexFile, mirrorProjectToShadow };
