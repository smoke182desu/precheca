@echo off
cd /d C:\Users\clark\Desktop\projetos\precheca
dir node_modules\.bin\tsc* > tsc_result.txt 2>&1
dir node_modules 2>&1 | findstr /i "typescript" >> tsc_result.txt
echo --- >> tsc_result.txt
dir . >> tsc_result.txt
