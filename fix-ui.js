const fs = require('fs');
let text = fs.readFileSync('public/adray-analytics.html', 'utf8');

// 1. Change backdrop
text = text.replace(
    'bg-gray-900 bg-opacity-50 transition-opacity hidden z-40 backdrop-blur-sm',
    'bg-black/80 transition-opacity hidden z-40 backdrop-blur-md'
);

// 2. Panel root: make it pure dark panel
text = text.replace(
    'max-w-md w-full bg-white shadow-2xl transform',
    'max-w-md w-full border-l border-purple-900/30 transform shadow-2xl'
);
// We will also add the adray-dashboard ops-panel class inline or inject style
text = text.replace(
    'z-50 flex flex-col pointer-events-auto',
    'z-50 flex flex-col pointer-events-auto bg-[#0a0711] text-gray-200'
);

// 3. Header bg and text
text = text.replace(
    'bg-white shadow-sm z-10',
    'bg-[#0a0711] shadow-xl z-10'
);
text = text.replace(
    'border-b border-gray-100 flex',
    'border-b border-purple-900/30 flex'
);

text = text.replace(
    'text-xs font-bold text-indigo-500 uppercase tracking-widest mb-1',
    'text-xs font-semibold text-purple-400 uppercase tracking-widest mb-1 shadow-sm'
);
text = text.replace(
    'text-xl font-bold text-gray-900 leading-tight',
    'text-xl font-bold text-gray-50 leading-tight'
);
text = text.replace(
    'text-xs text-gray-500 mt-0.5 font-mono',
    'text-xs text-gray-400 mt-0.5 font-mono'
);

// 4. Close button
text = text.replace(
    'text-gray-400 hover:text-gray-700 bg-gray-50 hover:bg-gray-100 p-2',
    'text-gray-400 hover:text-gray-200 bg-white/5 hover:bg-white/10 p-2'
);

// 5. Content block
text = text.replace(
    'overflow-y-auto p-6 bg-white" id="ue-content"',
    'overflow-y-auto p-6 bg-[#0a0711]" id="ue-content"'
);


// 6. JS injections
// Replace the timeline vertical line
text = text.replace(
    "let html = '<div class=\"relative border-l-2 border-indigo-100 ml-3        space-y-8 pb-10\">';",
    "let html = '<div class=\"relative border-l-2 border-purple-900/40 ml-3        space-y-8 pb-10\">';"
);
text = text.replace(
    "let html = '<div class=\"relative border-l-2 border-indigo-100 ml-3 space-y-8 pb-10\">';",
    "let html = '<div class=\"relative border-l-2 border-purple-900/40 ml-3 space-y-8 pb-10\">';"
);

// Fallback empty events
text = text.replace(
    "class=\"text-gray-500\">No hay eventos",
    "class=\"text-gray-400\">No hay eventos"
);

// New Session node
text = text.replaceAll(
    "bg-blue-500 border-4 border-white shadow-sm ring-1 ring-blue-100",
    "bg-blue-500/90 border-4 border-[#0a0711] shadow-sm ring-1 ring-blue-900/50"
);
text = text.replaceAll(
    "text-xs text-blue-600 font-bold",
    "text-xs text-blue-400 font-bold"
);
text = text.replaceAll(
    "bg-blue-50/50 rounded-lg p-3 text-sm text-gray-700 border border-blue-100/50",
    "bg-blue-900/20 rounded-lg p-3 text-sm text-blue-100 border border-blue-800/30"
);

// Order node
text = text.replaceAll(
    "bg-green-500 border-4 border-white shadow-sm ring-1 ring-green-100",
    "bg-emerald-500/90 border-4 border-[#0a0711] shadow-sm ring-1 ring-emerald-900/50"
);
text = text.replaceAll(
    "text-xs text-green-700 font-bold",
    "text-xs text-emerald-400 font-bold"
);
text = text.replaceAll(
    "bg-green-50/80 rounded-lg p-3 text-sm text-gray-800 border border-green-200",
    "bg-emerald-900/20 rounded-lg p-3 text-sm text-emerald-100 border border-emerald-800/30"
);

// Default dots
text = text.replaceAll(
    "let evClass = 'text-gray-500';",
    "let evClass = 'text-gray-400';"
);
text = text.replaceAll(
    "let evDot = 'bg-gray-300';",
    "let evDot = 'bg-gray-700';"
);
text = text.replaceAll(
    "evClass = 'text-indigo-600 font-semibold'; evDot = 'bg-indigo-400';",
    "evClass = 'text-indigo-400 font-semibold'; evDot = 'bg-indigo-500/80';"
);
text = text.replaceAll(
    "evClass = 'text-orange-600 font-semibold'; evDot = 'bg-orange-400';",
    "evClass = 'text-amber-400 font-semibold'; evDot = 'bg-amber-500/80';"
);
text = text.replaceAll(
    "ring-4 ring-white",
    "ring-4 ring-[#0a0711]"
);

fs.writeFileSync('public/adray-analytics.html', text, 'utf8');
console.log('Fixed UI styles.');
