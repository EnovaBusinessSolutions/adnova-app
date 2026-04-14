/**
 * Resuelve conflictos de merge incrustados en bundles JS de la landing estática.
 * Formato: <<<<<<<< Updated upstream:...\nVARIANT1\n========\nVARIANT2\n>>>>>>>> Stashed changes:...
 * Conserva VARIANT1 (upstream).
 */
const fs = require("fs");
const path = require("path");

const files = [
  "public/landing/_next/static/chunks/0u2cj~3foi6cs.js",
  "public/landing/_next/static/chunks/15ov7ped1b9~b.js",
];

function resolveConflict(s) {
  const needle = "<<<<<<<< Updated upstream:";
  const i = s.indexOf(needle);
  if (i === -1) return s;

  const line1End = s.indexOf("\n", i);
  if (line1End === -1) throw new Error("conflict marker incomplete");

  const sep = s.indexOf("\n========\n", line1End);
  if (sep === -1) throw new Error("missing ======== separator");

  const sep2 = s.indexOf("\n>>>>>>>> Stashed changes:", sep);
  if (sep2 === -1) throw new Error("missing >>>>>>>> Stashed marker");

  const endStashLine = s.indexOf("\n", sep2 + 1);
  const afterConflict = endStashLine === -1 ? "" : s.slice(endStashLine + 1);

  const variant1 = s.slice(line1End + 1, sep);
  return s.slice(0, i) + variant1 + afterConflict;
}

for (const rel of files) {
  const p = path.join(__dirname, "..", rel);
  let s = fs.readFileSync(p, "utf8");
  const before = s;
  s = resolveConflict(s);
  if (s === before) {
    console.log("unchanged:", rel);
    continue;
  }
  fs.writeFileSync(p, s, "utf8");
  console.log("fixed:", rel);
}
