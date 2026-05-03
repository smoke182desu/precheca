@echo off
cd /d "C:\Users\clark\Desktop\projetos\precheca"
"C:\Program Files\Git\cmd\git.exe" add src/lib/weatherService.ts src/lib/contextService.ts src/App.tsx
"C:\Program Files\Git\cmd\git.exe" commit -m "feat: clima real (Open-Meteo) + feriados + POIs OpenStreetMap + card Contexto Agora" > commit2_result.txt 2>&1
"C:\Program Files\Git\cmd\git.exe" push origin main >> commit2_result.txt 2>&1
echo DONE >> commit2_result.txt
