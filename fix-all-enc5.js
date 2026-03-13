const fs = require('fs');
let text = fs.readFileSync('public/adray-analytics.html', 'utf8');

const r = '\xef\xbf\xbd';

text = text.replaceAll(r + 'rdenes sin atribuci' + r + 'n', 'Órdenes sin atribución');
text = text.replaceAll('Atribuci' + r + 'n por Canal', 'Atribución por Canal');
text = text.replaceAll('Atribuci' + r + 'n y se' + r + 'ales', 'Atribución y señales');
text = text.replaceAll('fuente + atribuci' + r + 'n', 'fuente + atribución');
text = text.replaceAll('>Atribuci' + r + 'n<', '>Atribución<');
text = text.replaceAll('Cargando atribuci' + r + 'n...', 'Cargando atribución...');
text = text.replaceAll('Atribuci' + r + 'n (' + r + 'ltimo Clic)', 'Atribución (Último Clic)');
text = text.replaceAll('Usuario An' + r + 'nimo', 'Usuario Anónimo');
text = text.replaceAll('cronolog' + r + 'a', 'cronología');
text = text.replaceAll('Nueva Sesi' + r + 'n', 'Nueva Sesión');
text = text.replaceAll('Campa' + r + 'a', 'Campaña');
text = text.replaceAll('Agreg' + r + ' al carrito', 'Agregó al carrito');
text = text.replaceAll('Inici' + r + ' Checkout', 'Inició Checkout');
text = text.replaceAll('Cargando ' + r + r + 'rdenes...', 'Cargando órdenes...');

fs.writeFileSync('public/adray-analytics.html', text, 'utf8');
