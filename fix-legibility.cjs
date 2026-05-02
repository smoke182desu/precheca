const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

// Fix illegible form inputs
code = code.replace(/className="(.*?)bg-\[#f8f9fa\] border border-\[#dadce0\] text-white/g, 'className="$1bg-[#f8f9fa] border border-[#dadce0] text-[#202124]');

// Fix another weird button
code = code.replace(/text-white px-4 py-2 font-bold rounded-xl shadow-lg transition-transform hover:-trangray-y-1 active:trangray-y-0/g, 'text-white px-4 py-2 font-bold rounded-xl shadow-lg transition-transform hover:-translate-y-1 active:translate-y-0');

fs.writeFileSync('src/App.tsx', code);
console.log('Fixed illegible styling.');
