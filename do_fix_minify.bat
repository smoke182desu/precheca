@echo off
cd /d "C:\Users\clark\Desktop\projetos\precheca"
"C:\Program Files\Git\cmd\git.exe" add vite.config.ts
"C:\Program Files\Git\cmd\git.exe" commit -m "fix: desabilitar minifyIdentifiers no esbuild — resolve TDZ com React internals" > fix_minify_result.txt 2>&1
"C:\Program Files\Git\cmd\git.exe" push origin main >> fix_minify_result.txt 2>&1
echo DONE >> fix_minify_result.txt
