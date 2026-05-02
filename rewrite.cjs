const fs = require('fs');

let code = fs.readFileSync('src/App.tsx', 'utf8');

const replacements = [
  [/bg-slate-900/g, 'bg-gray-50'],
  [/bg-slate-800/g, 'bg-white'],
  [/bg-slate-700/g, 'bg-gray-100'],
  [/bg-slate-600/g, 'bg-gray-200'],
  [/border-slate-700/g, 'border-gray-200'],
  [/border-slate-600/g, 'border-gray-200'],
  [/text-slate-50/g, 'text-gray-900'],
  [/text-slate-100/g, 'text-gray-800'],
  [/text-slate-200/g, 'text-gray-700'],
  [/text-slate-300/g, 'text-gray-600'],
  [/text-slate-400/g, 'text-gray-500'],
  [/text-slate-500/g, 'text-gray-400'],
  [/bg-emerald-500/g, 'bg-[#1a73e8]'],
  [/hover:bg-emerald-600/g, 'hover:bg-[#1557b0]'],
  [/text-emerald-500/g, 'text-[#1a73e8]'],
  [/text-emerald-400/g, 'text-[#1a73e8]'],
  [/text-emerald-50/g, 'text-blue-50'],
  [/text-emerald-100/g, 'text-blue-100'],
  [/border-emerald-500/g, 'border-[#1a73e8]'],
  [/border-emerald-400/g, 'border-[#1a73e8]'],
  [/text-emerald-800/g, 'text-blue-800'],
  [/bg-emerald-100/g, 'bg-blue-100'],
  [/bg-emerald-400/g, 'bg-[#1a73e8]'],
  [/bg-emerald-500\/10/g, 'bg-blue-500\/10'],
  [/bg-emerald-500\/20/g, 'bg-blue-500\/20'],
  [/shadow-\[0_0_80px_rgba\(30,30,40,0.8\)\]/g, 'shadow-2xl'],
  [/bg-\[radial-gradient\(circle_at_center,_#1e293b_0%,_#0f172a_100%\)\]/g, 'bg-white'],
  [/bg-\[#0a0f1c\]/g, 'bg-gray-100']
];

for (const [regex, replacement] of replacements) {
  code = code.replace(regex, replacement);
}

fs.writeFileSync('src/App.tsx', code);
console.log("Replaced colors successfully.");
