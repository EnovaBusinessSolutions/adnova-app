"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "../public/landing");
const re = /<<<<<<<[^\r\n]*\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>>[^\r\n]*\r?\n?/g;

function resolveContent(s) {
  return s.replace(re, (_m, _upstream, stashed) => stashed);
}

function walk(dir) {
  const names = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of names) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.isFile() && (e.name.endsWith(".txt") || e.name.endsWith(".html"))) {
      let raw = fs.readFileSync(p, "utf8");
      if (!raw.includes("<<<<<<<")) continue;
      const next = resolveContent(raw);
      if (next !== raw) {
        fs.writeFileSync(p, next, "utf8");
        console.log("resolved:", path.relative(root, p));
      }
    }
  }
}

if (!fs.existsSync(root)) {
  console.error("missing", root);
  process.exit(1);
}
walk(root);
console.log("done");
