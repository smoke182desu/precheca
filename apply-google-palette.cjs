const fs = require('fs');

let code = fs.readFileSync('src/App.tsx', 'utf8');

// Replace all occurrences of gray-9000 (a typo from earlier)
code = code.replace(/gray-9000/g, 'gray-900');

// Fix gradients that were messed up
code = code.replace(/from-gray-50/g, 'from-white');
code = code.replace(/via-gray-50\/80/g, 'via-white/80');
code = code.replace(/bg-gray-100 min-h-screen/g, 'bg-gray-50 min-h-screen');

// Typography adjustments
code = code.replace(/text-gray-900/g, 'text-[#202124]');
code = code.replace(/text-gray-800/g, 'text-[#3c4043]');
code = code.replace(/text-gray-700/g, 'text-[#5f6368]');
code = code.replace(/text-gray-600/g, 'text-[#5f6368]');
code = code.replace(/text-gray-500/g, 'text-[#80868b]');
code = code.replace(/text-gray-400/g, 'text-[#9aa0a6]');

// Background adjustments
code = code.replace(/bg-gray-50/g, 'bg-[#f8f9fa]');
code = code.replace(/bg-gray-100/g, 'bg-[#f1f3f4]');
code = code.replace(/bg-gray-200/g, 'bg-[#e8eaed]');

// Border adjustments
code = code.replace(/border-gray-200/g, 'border-[#dadce0]');
code = code.replace(/border-gray-100/g, 'border-[#e8eaed]');

// Primary colors (Google Blue)
code = code.replace(/bg-blue-600/g, 'bg-[#1a73e8]');
code = code.replace(/hover:bg-blue-700/g, 'hover:bg-[#1557b0]');
code = code.replace(/text-blue-600/g, 'text-[#1a73e8]');
code = code.replace(/bg-blue-50/g, 'bg-[#e8f0fe]');
code = code.replace(/text-blue-50/g, 'text-[#e8f0fe]');
code = code.replace(/text-blue-100/g, 'text-[#d2e3fc]');

// Success colors (Google Green)
code = code.replace(/bg-green-100/g, 'bg-[#e6f4ea]');
code = code.replace(/text-green-800/g, 'text-[#137333]');
code = code.replace(/text-green-600/g, 'text-[#188038]');
code = code.replace(/bg-green-500/g, 'bg-[#1e8e3e]');

// Danger colors (Google Red)
code = code.replace(/bg-red-100/g, 'bg-[#fce8e6]');
code = code.replace(/text-red-800/g, 'text-[#c5221f]');
code = code.replace(/text-red-600/g, 'text-[#d93025]');
code = code.replace(/text-red-500/g, 'text-[#ea4335]');
code = code.replace(/bg-red-500/g, 'bg-[#ea4335]');
code = code.replace(/bg-red-50/g, 'bg-[#fce8e6]');
code = code.replace(/text-red-700/g, 'text-[#c5221f]');

// Warning colors (Google Yellow/Amber)
code = code.replace(/bg-amber-500/g, 'bg-[#f9ab00]');
code = code.replace(/text-amber-500/g, 'text-[#f9ab00]');
code = code.replace(/bg-amber-100/g, 'bg-[#fef7e0]');
code = code.replace(/text-amber-800/g, 'text-[#e37400]');

// Add Roboto font configuration
code = code.replace(/font-sans/g, 'font-sans tracking-normal');
code = code.replace(/font-black/g, 'font-bold');

fs.writeFileSync('src/App.tsx', code);
console.log("Applied Google Material Palette");
