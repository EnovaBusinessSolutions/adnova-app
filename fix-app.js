const fs = require('fs');
let text = fs.readFileSync('public/adray-analytics.html', 'utf8');

// Replace using node's proper unicode decoding locally!
function fix(search, rep) {
    if(text.includes(search)) {
        text = text.split(search).join(rep); 
    }
}

// These are derived from viewing the file directly 
fix('Usuario AnÃ³nimo', 'Usuario Anónimo');
fix('Usuario Annimo', 'Usuario Anónimo');
fix('Usuario An\ufffdnimo', 'Usuario Anónimo');

fix('cronologÃa', 'cronología');
fix('cronologa', 'cronología');
fix('cronolog\ufffda', 'cronología');

fix('SesiÃ³n', 'Sesión');
fix('Sesin', 'Sesión');
fix('Sesi\ufffdn', 'Sesión');

fix('CampaÃ±a', 'Campaña');
fix('Campaa', 'Campaña');
fix('Campa\ufffda', 'Campaña');

fix('AtribuciÃ³n (Ãšltimo Clic)', 'Atribución (Último Clic)');
fix('AtribuciÓn (Último Clic)', 'Atribución (Último Clic)');
fix('Atribucin (ltimo Clic)', 'Atribución (Último Clic)');
fix('Atribuci\ufffdn (\ufffdltimo Clic)', 'Atribución (Último Clic)');

fix('AgregÃ³ al carrito', 'Agregó al carrito');
fix('Agreg al carrito', 'Agregó al carrito');
fix('Agreg\ufffd al carrito', 'Agregó al carrito');

fix('IniciÃ³ Checkout', 'Inició Checkout');
fix('Inici Checkout', 'Inició Checkout');
fix('Inici\ufffd Checkout', 'Inició Checkout');

fix('Ã“rdenes', 'Órdenes');
fix('rdenes', 'Órdenes');
fix('\ufffdrdenes', 'Órdenes');

fix('AtribuciÃ³n', 'Atribución');
fix('Atribucin', 'Atribución');
fix('Atribuci\ufffdn', 'Atribución');

fix('seÃ±ales', 'señales');
fix('seales', 'señales');
fix('se\ufffdales', 'señales');

// Fix Panel UI Classes to match rest of dashboard
const oldPanelHeader = `      <div id="user-explorer-panel" class="fixed inset-y-0 right-0 max-w-md w-full bg-white shadow-2xl transform translate-x-full transition-transform duration-300 ease-in-out z-50 flex flex-col pointer-events-auto">
          <div class="px-6 py-5 border-b border-gray-100 flex justify-between items-center bg-white shadow-sm z-10">`;

const newPanelHeader = `      <div id="user-explorer-panel" class="fixed inset-y-0 right-0 max-w-md w-full bg-white shadow-2xl transform translate-x-full transition-transform duration-300 ease-in-out z-50 flex flex-col pointer-events-auto border-l border-gray-200">
          <div class="px-6 py-4 border-b border-gray-200 bg-gray-50 flex justify-between items-start z-10">`;

const oldKickerTitle = `              <div>
                  <p class="text-xs font-bold text-indigo-500 uppercase tracking-widest mb-1">Recorrido del Cliente</p>
                  <h2 class="text-xl font-bold text-gray-900 leading-tight" id="ue-name">Cargando...</h2>`;

const newKickerTitle = `              <div>
                  <p class="panel-kicker">Recorrido del Cliente</p>
                  <h2 class="panel-title text-xl leading-6 font-medium text-gray-900" id="ue-name">Cargando...</h2>`;

const oldButton = `              <button onclick="closeUserExplorer()" class="text-gray-400 hover:text-gray-700 bg-gray-50 hover:bg-gray-100 p-2 rounded-full focus:outline-none transition-colors">
                  <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
              </button>`;

const newButton = `              <button onclick="closeUserExplorer()" class="text-gray-400 hover:text-gray-500 bg-white border border-gray-200 hover:bg-gray-50 p-2 rounded-md focus:outline-none transition-colors shadow-sm ml-4 mt-1">
                  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
              </button>`;

text = text.split(oldPanelHeader).join(newPanelHeader);
text = text.split(oldKickerTitle).join(newKickerTitle);
text = text.split(oldButton).join(newButton);

fs.writeFileSync('public/adray-analytics.html', text, 'utf8');
console.log('Fixed encodings and styles cleanly.');
