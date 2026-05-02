const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(/text-\[#80868b\] hover:text-white/g, 'text-[#80868b] hover:text-[#202124]');
code = code.replace(/bg-emerald-600 hover:bg-\[#1a73e8\] border border-\[#1a73e8\]/g, 'bg-[#1e8e3e] hover:bg-[#137333]');
code = code.replace(/bg-emerald-600 hover:bg-\[#1a73e8\]/g, 'bg-[#1e8e3e] hover:bg-[#137333]');

// Some places where I broke generic Tailwind translates
code = code.replace(/trangray-y/g, 'translate-y');

fs.writeFileSync('src/App.tsx', code);
