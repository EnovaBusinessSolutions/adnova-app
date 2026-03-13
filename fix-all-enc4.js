const fs = require('fs');
let text = fs.readFileSync('public/adray-analytics.html', 'utf8');

text = text.replace(/[^>]*?rdenes sin atribuci[^<]*/g, 'Órdenes sin atribución');
text = text.replace(/Atribuci[^<]*?n por Canal/g, 'Atribución por Canal');
text = text.replace(/Atribuci[^<]*?n y se[^<]*?ales/g, 'Atribución y señales');
text = text.replace(/fuente \+ atribuci[^<]*?n/g, 'fuente + atribución');
text = text.replace(/>Atribuci[^<]*?n</g, '>Atribución<');
text = text.replace(/Cargando atribuci[^<]*?n\.\.\./g, 'Cargando atribución...');
text = text.replace(/Atribuci[.]{1,4}n \([.]{1,4}ltimo Clic\)/g, 'Atribución (Último Clic)');

fs.writeFileSync('public/adray-analytics.html', text, 'utf8');
