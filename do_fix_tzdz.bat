@echo off
cd /d "C:\Users\clark\Desktop\projetos\precheca"
"C:\Program Files\Git\cmd\git.exe" add src/components/SettingsWizard.tsx src/App.tsx
"C:\Program Files\Git\cmd\git.exe" commit -m "fix: mover STEP_TITLES para modulo — corrige TDZ Re no bundle minificado" > fix_tzdz_result.txt 2>&1
"C:\Program Files\Git\cmd\git.exe" push origin main >> fix_tzdz_result.txt 2>&1
echo DONE >> fix_tzdz_result.txt
