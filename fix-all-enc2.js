const fs = require('fs');
let text = fs.readFileSync('public/adray-analytics.html', 'utf8');

text = text.replace(/Usuario An.*?nimo/g, 'Usuario Anónimo');
text = text.replace(/Nueva Sesi.*?n/g, 'Nueva Sesión');
text = text.replace(/Campa.*?a:/g, 'Campaña:');
text = text.replace(/Agreg.*? al carrito/g, 'Agregó al carrito');
text = text.replace(/Inici.*? Checkout/g, 'Inició Checkout');
text = text.replace(/cronolog.*?a/g, 'cronología');

fs.writeFileSync('public/adray-analytics.html', text, 'utf8');
