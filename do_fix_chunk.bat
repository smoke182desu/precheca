@echo off
cd /d "C:\Users\clark\Desktop\projetos\precheca"
"C:\Program Files\Git\cmd\git.exe" add vite.config.ts src/components/SettingsWizard.tsx
"C:\Program Files\Git\cmd\git.exe" commit -m "fix: separar SettingsWizard em chunk proprio — resolve colisao de nomes no esbuild" > fix_chunk_result.txt 2>&1
"C:\Program Files\Git\cmd\git.exe" push origin main >> fix_chunk_result.txt 2>&1
echo DONE >> fix_chunk_result.txt
