@echo off
cd /d "C:\Users\clark\Desktop\projetos\precheca"
"C:\Program Files\Git\cmd\git.exe" add src/lib/eventsService.ts src/lib/contextService.ts src/App.tsx .env.example
"C:\Program Files\Git\cmd\git.exe" commit -m "feat: eventos culturais e esportivos — Ticketmaster + football-data.org + heuristica" > commit5_result.txt 2>&1
"C:\Program Files\Git\cmd\git.exe" push origin main >> commit5_result.txt 2>&1
echo DONE >> commit5_result.txt
