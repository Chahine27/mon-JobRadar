# Démarre la base de données (PostgreSQL intégré, sans Docker) en arrière-plan, invisible, si elle ne tourne pas déjà.
function DbPort {
  $line = Get-Content ".env" -Encoding UTF8 | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
  if ($line -match ':(\d+)/') { return [int]$Matches[1] } else { return 5433 }
}
function PortOpen($port) {
  $c = New-Object Net.Sockets.TcpClient
  try { return ($c.ConnectAsync("127.0.0.1", $port).Wait(700) -and $c.Connected) } catch { return $false } finally { $c.Dispose() }
}
function StartDatabase {
  $port = DbPort
  if (PortOpen $port) { return $true }
  Start-Process -FilePath "node" -ArgumentList "packages/db/scripts/db-server.mjs" -WorkingDirectory (Get-Location) -WindowStyle Hidden
  # La toute première fois, la création de la base prend jusqu'à une minute.
  for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 1
    if (PortOpen $port) { return $true }
  }
  return $false
}
