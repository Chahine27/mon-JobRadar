# Crée le raccourci « Job Radar » sur le Bureau (à lancer une seule fois : clic droit → « Exécuter avec PowerShell »).
$root = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath("Desktop")
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut((Join-Path $desktop "Job Radar.lnk"))
# wscript + .vbs : aucune fenêtre, même pas un instant (le .cmd en fait clignoter une).
$link.TargetPath = Join-Path $env:SystemRoot "System32\wscript.exe"
$link.Arguments = "`"$(Join-Path $PSScriptRoot 'lancer-cache.vbs')`""
$link.WorkingDirectory = $root
$link.IconLocation = (Join-Path $PSScriptRoot "job-radar.ico") + ",0"
$link.Description = "Lance Job Radar en arrière-plan (base de données, IA locale et site)"
$link.Save()
Write-Host "Raccourci « Job Radar » créé sur le Bureau." -ForegroundColor Green
Write-Host "Astuce : clic droit dessus → « Épingler à la barre des tâches » (ou « Afficher d'autres options » sous Windows 11)."
Read-Host "Appuie sur Entrée pour fermer"
