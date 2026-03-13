const fs = require('fs');
let text = fs.readFileSync('public/adray-analytics.html', 'utf8');

text = text.replace(/ï¿½rdenes sin atribuciï¿½n/g, 'Órdenes sin atribución');
text = text.replace(/Atribuciï¿½n por Canal/g, 'Atribución por Canal');
text = text.replace(/Atribuciï¿½n y seï¿½ales/g, 'Atribución y señales');
text = text.replace(/fuente \+ atribuciï¿½n/g, 'fuente + atribución');
text = text.replace(/>Atribuciï¿½n</g, '>Atribución<');
text = text.replace(/Cargando atribuciï¿½n\.\.\./g, 'Cargando atribución...');
text = text.replace(/Atribuciï¿½n \(ï¿½ltimo Clic\)/g, 'Atribución (Último Clic)');

fs.writeFileSync('public/adray-analytics.html', text, 'utf8');
