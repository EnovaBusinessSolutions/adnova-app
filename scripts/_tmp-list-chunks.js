const fs = require("fs");
const h = fs.readFileSync("public/landing/pricing/index.html", "utf8");
const m = h.match(/chunks\/[^"']+\.js/g);
console.log([...new Set(m || [])]);
