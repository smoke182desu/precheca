@echo off
cd /d "C:\Users\clark\Desktop\projetos\precheca"
"C:\Program Files\Git\cmd\git.exe" add src/App.tsx
"C:\Program Files\Git\cmd\git.exe" commit -m "fix: mover imports para o topo do App.tsx — corrige crash de inicializacao" > fix_result.txt 2>&1
"C:\Program Files\Git\cmd\git.exe" push origin main >> fix_result.txt 2>&1
echo DONE >> fix_result.txt
