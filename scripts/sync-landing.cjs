"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "landing-adray", "out");
const dest = path.join(root, "public", "landing");

if (!fs.existsSync(outDir)) {
  console.error(
    "sync-landing: falta landing-adray/out. Ejecuta antes: npm --prefix landing-adray run build"
  );
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
fs.cpSync(outDir, dest, { recursive: true });
console.log("sync-landing:", outDir, "->", dest);
