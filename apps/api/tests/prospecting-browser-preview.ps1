param([ValidateSet('start','stop')][string]$Action = 'start')
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$entry = (Resolve-Path (Join-Path $PSScriptRoot 'prospecting-browser-runtime.ts')).Path
$loader = './apps/api/tests/platform-support-loader.mjs'
$folder = Join-Path $project '.specs/features/admin-company-prospecting/browser-runtime'
$null = New-Item -ItemType Directory -Force -Path $folder
$receiptPath = Join-Path $folder 'listeners.json'
if ($Action -eq 'stop') {
  $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
  $process = Get-CimInstance Win32_Process -Filter ("ProcessId = " + [int]$receipt.apiPid)
  if ($receipt.mode -ne 'preview' -or !$process -or $process.Name -ne 'node.exe' -or !$process.CommandLine.Contains($entry) -or !$process.CommandLine.Contains('--preview')) { throw 'preview_ownership_mismatch' }
  New-Item -Path (Join-Path $folder ('stop-' + [int]$receipt.apiPid)) -ItemType File -Force | Out-Null
  Wait-Process -Id $receipt.apiPid -Timeout 30
  Write-Output 'Prévia encerrada. Dados locais preservados.'
  exit 0
}
foreach ($port in 3019,5179,5180,5181) {
  if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {throw "Porta ocupada: $port"}
}
$node = (Get-Command node.exe).Source
$taskProcess = Start-Process -FilePath $node -ArgumentList @('--loader',('"' + $loader + '"'),('"' + $entry + '"'),'--preview') -WorkingDirectory $project -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $folder 'preview.stdout.log') -RedirectStandardError (Join-Path $folder 'preview.stderr.log')
$deadline = [datetime]::UtcNow.AddSeconds(90)
do {
  if ($taskProcess.HasExited) {throw "Inicialização falhou. Consulte preview.stderr.log. Código $($taskProcess.ExitCode)"}
  if (Test-Path -LiteralPath $receiptPath) {
    $receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
    if ($receipt.apiPid -eq $taskProcess.Id -and $receipt.mode -eq 'preview') {Write-Output $receipt.origins; exit 0}
  }
  Start-Sleep -Milliseconds 300
} while ([datetime]::UtcNow -lt $deadline)
throw 'Tempo de inicialização excedido.'
