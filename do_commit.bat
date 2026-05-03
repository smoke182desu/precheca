@echo off
cd /d "C:\Users\clark\Desktop\projetos\precheca"
"C:\Program Files\Git\cmd\git.exe" add src/components/SettingsWizard.tsx src/App.tsx
"C:\Program Files\Git\cmd\git.exe" status > commit_result.txt 2>&1
"C:\Program Files\Git\cmd\git.exe" commit -m "feat: wizard de onboarding + algoritmo de aprendizado conectado" >> commit_result.txt 2>&1
"C:\Program Files\Git\cmd\git.exe" push origin main >> commit_result.txt 2>&1
echo DONE >> commit_result.txt
