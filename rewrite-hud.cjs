const fs = require('fs');

let code = fs.readFileSync('src/App.tsx', 'utf8');

const replacements = [
  [/from-slate-900/g, 'from-gray-50'],
  [/via-slate-900\/80/g, 'via-gray-50/80'],
  // Fix text colors in the HUD
  [/text-white text-lg font-black/g, 'text-gray-900 text-lg font-black'],
  [/text-white text-base font-black truncate/g, 'text-gray-900 text-base font-black truncate'],
  [/shadow-\[0_0_20px_rgba\(16,185,129,0\.5\)\]/g, 'shadow-lg'],
  [/shadow-\[0_0_8px_rgba\(16,185,129,0\.8\)\]/g, 'shadow-md'],
  [/shadow-\[0_-8px_30px_rgba\(0,0,0,0\.6\)\]/g, 'shadow-[0_-8px_30px_rgba(0,0,0,0.1)]'],
  [/bg-emerald-900\/30/g, 'bg-blue-50'],
  [/bg-emerald-900\/40/g, 'bg-[#e8f0fe]'],
  [/border-emerald-700\/50/g, 'border-blue-200'],
  [/text-emerald-50/g, 'text-gray-900'],
  [/text-emerald-100\/90/g, 'text-gray-700'],
  // Replace Map properties to make it light mode instead of dark_all
  [/dark_all/g, 'light_all'],
  [/bg-slate-900\/90/g, 'bg-white/90'],
  [/bg-slate-900\/70/g, 'bg-white/70'],
  [/bg-blue-500\/20/g, 'bg-blue-50'],
  [/border-indigo-500\/50/g, 'border-blue-100'],
  [/bg-indigo-500\/20/g, 'bg-[#e8f0fe]'],
  [/text-indigo-400/g, 'text-[#1a73e8]'],
  [/text-indigo-300/g, 'text-gray-500'],
  [/border-blue-500\/30/g, 'border-blue-200']
];

for (const [regex, replacement] of replacements) {
  code = code.replace(regex, replacement);
}

fs.writeFileSync('src/App.tsx', code);
console.log("HUD and overlay colors fixed.");
