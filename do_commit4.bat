@echo off
cd /d "C:\Users\clark\Desktop\projetos\precheca"
"C:\Program Files\Git\cmd\git.exe" add src/components/SettingsWizard.tsx
"C:\Program Files\Git\cmd\git.exe" commit -m "feat: SettingsWizard conversacional — cards de horario, preferencias e perfil de seguranca" > commit4_result.txt 2>&1
"C:\Program Files\Git\cmd\git.exe" push origin main >> commit4_result.txt 2>&1
echo DONE >> commit4_result.txt
