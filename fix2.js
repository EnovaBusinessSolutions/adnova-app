const fs = require('fs');
let text = fs.readFileSync('public/adray-analytics.html', 'utf8');

text = text.replace(/Atribuci&oacute;n \([^\s]+ltimo Clic\)/g, 'Atribuci&oacute;n (&Uacute;ltimo Clic)');

fs.writeFileSync('public/adray-analytics.html', text, 'utf8');
