const fs = require('fs');
let text = fs.readFileSync('public/adray-analytics.html', 'utf8');

text = text.replace(
    /class="px-6 py-4 border-b border-gray-200 bg-gray-50 flex justify-between items-start z-10"/g,
    'class="px-6 py-4 border-b border-purple-900/30 bg-[#0a0711] flex justify-between items-start z-10"'
);

text = text.replace(
    /class="panel-kicker">Recorrido del Cliente<\/p>/g,
    'class="text-xs font-semibold text-purple-400 uppercase tracking-widest mb-1 shadow-sm">Recorrido del Cliente</p>'
);

text = text.replace(
    /class="panel-title text-xl leading-6 font-medium text-gray-900" id="ue-name">Cargando...<\/h2>/g,
    'class="text-xl font-bold text-gray-50 leading-tight" id="ue-name">Cargando...</h2>'
);

text = text.replace(
    /class="text-xs text-gray-500 mt-1 font-mono" id="ue-email">...<\/p>/g,
    'class="text-xs text-gray-400 mt-1 font-mono" id="ue-email">...</p>'
);

text = text.replace(
    /class="text-gray-400 hover:text-gray-500 bg-white border border-gray-200 hover:bg-gray-50 p-2 rounded-md focus:outline-none transition-colors shadow-sm ml-4 mt-1"/g,
    'class="text-gray-400 hover:text-gray-200 bg-white/5 border border-purple-900/30 hover:bg-white/10 p-2 rounded-md focus:outline-none transition-colors shadow-sm ml-4 mt-1"'
);

text = text.replace(
    /id="user-explorer-panel" class="fixed inset-y-0 right-0 max-w-md w-full bg-white shadow-2xl transform translate-x-full transition-transform duration-300 ease-in-out z-50 flex flex-col pointer-events-auto border-l border-gray-200"/g,
    'id="user-explorer-panel" class="fixed inset-y-0 right-0 max-w-md w-full bg-[#0a0711] text-gray-200 shadow-2xl transform translate-x-full transition-transform duration-300 ease-in-out z-50 flex flex-col pointer-events-auto border-l border-purple-900/30"'
);

fs.writeFileSync('public/adray-analytics.html', text, 'utf8');
console.log('Fixed header');
