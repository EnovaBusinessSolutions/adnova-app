const fs = require('fs');
let text = fs.readFileSync('public/adray-analytics.html', 'utf8');

text = text.replace(/Usuario An\ufffdnimo/g, 'Usuario Anónimo');
text = text.replace(/Error al cargar la cronolog\ufffda/g, 'Error al cargar la cronología');
text = text.replace(/Nueva Sesi\ufffdn/g, 'Nueva Sesión');
text = text.replace(/Campa\ufffda:/g, 'Campaña:');
text = text.replace(/Atribuci\ufffdn \(\ufffdltimo Clic\)/g, 'Atribución (Último Clic)');
text = text.replace(/Agreg\ufffd al carrito/g, 'Agregó al carrito');
text = text.replace(/Inici\ufffd Checkout/g, 'Inició Checkout');

fs.writeFileSync('public/adray-analytics.html', text, 'utf8');
console.log('Fixed encodings in adray-analytics.html');
