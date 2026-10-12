# Essai rapide de l'API (etape 3). Lancer d'abord "pnpm dev:api" dans une autre fenetre.
$ErrorActionPreference = "Stop"
$api = "http://127.0.0.1:3000"
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession

Write-Host "1) Sante du serveur" -ForegroundColor Cyan
Invoke-RestMethod "$api/api/health"

Write-Host "2) Connexion" -ForegroundColor Cyan
$email = Read-Host "Email"
$secure = Read-Host "Mot de passe (celui du .env)" -AsSecureString
$password = [System.Net.NetworkCredential]::new("", $secure).Password
$body = @{ email = $email; password = $password } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$api/api/auth/login" -Body $body -ContentType "application/json" -WebSession $session

Write-Host "3) Ton profil" -ForegroundColor Cyan
Invoke-RestMethod "$api/api/profile" -WebSession $session | ConvertTo-Json -Depth 6

Write-Host "4) Deconnexion" -ForegroundColor Cyan
Invoke-RestMethod -Method Post -Uri "$api/api/auth/logout" -Body "{}" -ContentType "application/json" -WebSession $session
Write-Host "OK - tout fonctionne." -ForegroundColor Green
