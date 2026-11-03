@echo off
rem Pobiera aktualna oferte z obligacjeskarbowe.pl i otwiera kalkulator
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
python fetch_bonds.py
start "" "%~dp0index.html"
