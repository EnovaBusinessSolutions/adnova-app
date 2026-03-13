const fs = require('fs');
let text = fs.readFileSync('public/adray-analytics.html', 'utf8');

function fix(search, rep) {
    if(text.includes(search)) {
        text = text.split(search).join(rep); 
    }
}

fix('Usuario AnÃ³nimo', 'Usuario Anónimo');
fix('Usuario Annimo', 'Usuario Anónimo');
fix('Usuario An\ufffdnimo', 'Usuario Anónimo');
fix('cronologÃa', 'cronología');
fix('cronologa', 'cronología');
fix('cronolog\ufffda', 'cronología');
fix('SesiÃ³n', 'Sesión');
fix('Sesi\ufffdn', 'Sesión');
fix('CampaÃ±a', 'Campaña');
fix('Campa\ufffda', 'Campaña');
fix('AtribuciÃ³n (Ãšltimo Clic)', 'Atribución (Último Clic)');
fix('AtribuciÃ³n (ltimo Clic)', 'Atribución (Último Clic)');
fix('AgregÃ³ al carrito', 'Agregó al carrito');
fix('Agreg\ufffd al carrito', 'Agregó al carrito');
fix('IniciÃ³ Checkout', 'Inició Checkout');
fix('Inici\ufffd Checkout', 'Inició Checkout');
fix('Ã“rdenes', 'Órdenes');
fix('\ufffdrdenes', 'Órdenes');
fix('AtribuciÃ³n', 'Atribución');
fix('Atribuci\ufffdn', 'Atribución');
fix('seÃ±ales', 'señales');
fix('se\ufffdales', 'señales');

fs.writeFileSync('public/adray-analytics.html', text, 'utf8');
console.log('Fixed encodings.');
