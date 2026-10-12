# Lance Job Radar en un double-clic : base de données (intégrée, sans Docker), Ollama (IA), mises à jour, puis « pnpm dev ».
# Appelé par « Lancer Job Radar.cmd » à la racine du projet, en arrière-plan (aucune fenêtre) :
# le journal de l'appli va dans job-radar.log, et le bouton « Arrêter Job Radar » du site arrête tout.
# « Continue » : avec « Stop », Windows PowerShell 5 s'arrête dès qu'un programme écrit sur sa sortie d'erreur.
$ErrorActionPreference = "Continue"
# Titre obligatoire : avec un titre de console vide, Node plante (« Assertion failed: process_title »).
$Host.UI.RawUI.WindowTitle = "Job Radar"
Set-Location (Split-Path -Parent $PSScriptRoot)
. (Join-Path $PSScriptRoot "db.ps1")
$url = "http://localhost:5173"
$log = Join-Path (Get-Location) "job-radar.log"

function Step($text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Cyan }
# Pas de fenêtre pour afficher l'erreur : un message à l'écran.
function Fail($text) {
  Add-Type -AssemblyName System.Windows.Forms
  [void][Windows.Forms.MessageBox]::Show("Job Radar ne démarre pas : $text", "Job Radar", "OK", "Error")
  exit 1
}
function Responds($address) {
  try { Invoke-WebRequest $address -UseBasicParsing -TimeoutSec 2 | Out-Null; return $true } catch { return $false }
}

# 0. Déjà lancé ? On arrête l'ancienne version (sinon elle garde l'ancien code) avant de tout relancer.
$root = (Get-Location).Path
$old = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*$root*" }
if ($old) {
  Step "Arrêt de l'ancienne fenêtre de Job Radar"
  $old | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
}
# Ports du site (5173) et du serveur (3000) encore pris : un autre programme (ou une copie de Job Radar dans un autre dossier).
foreach ($port in 5173, 3000) {
  $owner = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($owner) {
    $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($owner.OwningProcess)").CommandLine
    Fail "le port $port est déjà pris par un autre programme :`n  $cmd`nFerme sa fenêtre (ou redémarre le PC), puis relance Job Radar."
  }
}

if (-not (Test-Path ".env")) { Fail "le fichier .env est introuvable dans $(Get-Location)." }
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { Fail "pnpm est introuvable. Installe Node.js puis pnpm (voir docs/LANCEMENT.md)." }

# 1. Base de données intégrée (PostgreSQL lancé par Node, fichiers dans data\postgres) : démarrée en arrière-plan si elle ne tourne pas déjà.
Step "Base de données"
if (-not (StartDatabase)) { Fail "la base de données ne démarre pas. Regarde le fichier data\postgres.log pour le détail." }
Write-Host "Base de données prête." -ForegroundColor Green

# 2. Ollama (IA locale) : lancé s'il ne tourne pas. Pas bloquant : l'appli marche sans.
Step "IA locale (Ollama)"
if (Responds "http://127.0.0.1:11434/api/version") {
  Write-Host "Ollama tourne déjà." -ForegroundColor Green
} else {
  $ollamaApp = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama app.exe"
  if (Test-Path $ollamaApp) {
    Start-Process $ollamaApp
    Write-Host "Ollama démarre." -ForegroundColor Green
  } elseif (Get-Command ollama -ErrorAction SilentlyContinue) {
    Start-Process ollama -ArgumentList "serve" -WindowStyle Hidden
    Write-Host "Ollama démarre." -ForegroundColor Green
  } else {
    Write-Host "Ollama introuvable : l'IA sera indisponible (le reste marche)." -ForegroundColor Yellow
  }
}

# 3. Après une mise à jour du code : modules et base de données à jour
Step "Mises à jour"
$stamp = "node_modules\.modules.yaml"
if (-not (Test-Path $stamp) -or (Get-Item "pnpm-lock.yaml").LastWriteTime -gt (Get-Item $stamp).LastWriteTime) {
  Write-Host "Installation des modules (pnpm install)..."
  pnpm install
  if ($LASTEXITCODE -ne 0) { Fail "pnpm install a échoué." }
}
pnpm --filter @job-radar/db migrate:deploy
if ($LASTEXITCODE -ne 0) { Fail "la mise à jour de la base de données a échoué (migrate deploy)." }
pnpm db:generate | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "prisma generate a échoué." }
Write-Host "Tout est à jour." -ForegroundColor Green

# 4. Ouvre le site quand le site ET le serveur répondent (en arrière-plan), puis lance l'appli dans cette fenêtre
Start-Job -ArgumentList $url -ScriptBlock {
  param($u)
  for ($i = 0; $i -lt 90; $i++) {
    try {
      Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 2 | Out-Null
      Invoke-WebRequest "$u/api/health" -UseBasicParsing -TimeoutSec 2 | Out-Null
      break
    } catch { Start-Sleep -Seconds 1 }
  }
  Start-Process $u
} | Out-Null

# Tourne caché jusqu'au bouton « Arrêter Job Radar » du site : le serveur crée alors job-radar.stop, et on arrête
# tout ce que « pnpm dev » a lancé (serveur + site). Sa sortie (pour comprendre un problème) va dans job-radar.log.
$stopFile = Join-Path (Get-Location) "job-radar.stop"
Remove-Item $stopFile -ErrorAction SilentlyContinue
$env:JOB_RADAR_STOP_FILE = $stopFile
Set-Content $log "Job Radar — lancement du $(Get-Date)" -Encoding UTF8
$app = Start-Process cmd.exe -ArgumentList "/d /c pnpm dev >> `"$log`" 2>&1" -WindowStyle Hidden -PassThru
while (-not $app.HasExited -and -not (Test-Path $stopFile)) { Start-Sleep -Seconds 1 }
taskkill /PID $app.Id /T /F 2>&1 | Out-Null
Remove-Item $stopFile -ErrorAction SilentlyContinue
