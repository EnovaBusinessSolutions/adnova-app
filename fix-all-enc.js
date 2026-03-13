const fs = require('fs');
let text = fs.readFileSync('public/adray-analytics.html', 'utf8');

text = text.replace(/Atribuci.*?n por Canal/, 'Atribución por Canal');
text = text.replace(/Atribuci.*?n y se.*?ales/, 'Atribución y señales');
text = text.replace(/ingreso \+ productos \+ fuente \+ atribuci.*?n/, 'ingreso + productos + fuente + atribución');
text = text.replace(/>Atribuci.*?n</, '>Atribución<');
text = text.replace(/Cargando .*?rdenes.../, 'Cargando órdenes...');
text = text.replace(/Cargando atribuci.*?n.../, 'Cargando atribución...');
text = text.replace(/Atribuci.*?n \([^]*?ltimo Clic\)/g, 'Atribución (Último Clic)');
text = text.replace(/Ã“ï¿½rdenes sin atribuciÃ³n/g, 'Órdenes sin atribución');

fs.writeFileSync('public/adray-analytics.html', text, 'utf8');
