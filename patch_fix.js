const fs = require('fs');
let auth = fs.readFileSync('backend/auth.js', 'utf8');

let startIndex = auth.indexOf('passport.use(');
let block = auth.substring(startIndex);
let lines = block.split('\n');

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('// Serial')) {
    lines.splice(i, 0, '}');
    break;
  }
}

auth = auth.substring(0, startIndex) + lines.join('\n');
fs.writeFileSync('backend/auth.js', auth);
