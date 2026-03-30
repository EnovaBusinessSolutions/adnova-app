const fs = require('fs');
let auth = fs.readFileSync('backend/auth.js', 'utf8');
auth = auth.replace("}\r\n}\r\n// Serializaci", "}\r\n// Serializaci");
auth = auth.replace("}\n}\n// Serializaci", "}\n// Serializaci");
fs.writeFileSync('backend/auth.js', auth);
