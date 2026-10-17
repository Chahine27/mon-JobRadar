# Copie la base du serveur AWS sur ce PC, dans data\sauvegardes\serveur (les 30 dernières sont gardées).
# Lancé chaque jour par la tâche planifiée « Job Radar - sauvegarde » (ou dès que le PC se rallume s'il était éteint).
# Restaurer une copie : pg_restore --clean --no-owner -d <DATABASE_URL> <fichier .dump>
$ErrorActionPreference = "Stop"
# ssh de Git : celui de Windows refuse ~/.ssh/config (droits partagés avec un autre compte du PC).
$ssh = "C:\Program Files\Git\usr\bin\ssh.exe"
$scp = "C:\Program Files\Git\usr\bin\scp.exe"
$dir = Join-Path (Split-Path -Parent $PSScriptRoot) "data\sauvegardes\serveur"
New-Item -ItemType Directory -Force $dir | Out-Null
$name = "jobradar-$(Get-Date -Format yyyy-MM-dd).dump"
$log = Join-Path $dir "sauvegarde.log"

try {
  # Fichier fait sur le serveur puis rapatrié par scp : la redirection « > » de PowerShell abîmerait un fichier binaire.
  & $ssh -o BatchMode=yes jobradar "sudo -u postgres pg_dump -Fc -f /tmp/$name jobradar"
  if ($LASTEXITCODE -ne 0) { throw "pg_dump a échoué sur le serveur" }
  & $scp -q -o BatchMode=yes "jobradar:/tmp/$name" (Join-Path $dir $name)
  if ($LASTEXITCODE -ne 0) { throw "la copie vers le PC a échoué" }
  & $ssh -o BatchMode=yes jobradar "sudo rm -f /tmp/$name"
  Get-ChildItem $dir -Filter "jobradar-*.dump" | Sort-Object Name -Descending | Select-Object -Skip 30 | Remove-Item
  Add-Content -Encoding UTF8 $log "$(Get-Date -Format s) OK $name ($([math]::Round((Get-Item (Join-Path $dir $name)).Length / 1MB, 1)) Mo)"
} catch {
  Add-Content -Encoding UTF8 $log "$(Get-Date -Format s) ÉCHEC : $_"
  exit 1
}
