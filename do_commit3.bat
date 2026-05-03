@echo off
cd /d "C:\Users\clark\Desktop\projetos\precheca"
"C:\Program Files\Git\cmd\git.exe" add src/lib/missionPlanner.ts src/types.ts src/App.tsx
"C:\Program Files\Git\cmd\git.exe" commit -m "feat: Mission Planner — 3 missoes com alternativas, estimativas reais e log no Firestore" > commit3_result.txt 2>&1
"C:\Program Files\Git\cmd\git.exe" push origin main >> commit3_result.txt 2>&1
echo DONE >> commit3_result.txt
