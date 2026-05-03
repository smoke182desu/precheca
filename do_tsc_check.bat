@echo off
cd /d "C:\Users\clark\Desktop\projetos\precheca"
"C:\Program Files\nodejs\npx.cmd" tsc --noEmit > tsc_result.txt 2>&1
echo EXIT:%ERRORLEVEL% >> tsc_result.txt
