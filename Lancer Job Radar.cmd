@echo off
rem Double-clic : lance Job Radar en arriere-plan, sans fenetre (Docker + IA + pnpm dev). Voir scripts\lancer.ps1
rem Pour arreter : bouton "Arreter Job Radar" en bas du menu du site.
start "" wscript.exe "%~dp0scripts\lancer-cache.vbs"
