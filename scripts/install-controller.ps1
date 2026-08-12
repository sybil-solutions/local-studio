[CmdletBinding()]
param(
  [ValidateSet('Install', 'Update', 'Start', 'Stop', 'Restart', 'Status', 'Remove', 'Plan')]
  [string]$Action = 'Install',
  [string]$InstallDir = $env:LOCAL_STUDIO_DIR,
  [string]$DataDir = $env:LOCAL_STUDIO_DATA_DIR,
  [string]$ModelsDir = $env:LOCAL_STUDIO_MODELS_DIR,
  [string]$HostAddress = $env:LOCAL_STUDIO_HOST,
  [int]$Port = 0,
  [string]$Repo = $env:LOCAL_STUDIO_REPO
)

$ErrorActionPreference = 'Stop'

if (-not $InstallDir) { $InstallDir = Join-Path $env:LOCALAPPDATA 'Local Studio\controller-source' }
if (-not $DataDir) { $DataDir = Join-Path $env:LOCALAPPDATA 'Local Studio\controller-data' }
if (-not $ModelsDir) { $ModelsDir = Join-Path $DataDir 'models' }
if (-not $HostAddress) { $HostAddress = '127.0.0.1' }
if ($Port -eq 0 -and $env:LOCAL_STUDIO_PORT) { $Port = [int]$env:LOCAL_STUDIO_PORT }
if ($Port -eq 0) { $Port = 8080 }
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Port must be between 1024 and 65535' }
if (-not $Repo) { $Repo = 'https://github.com/sybil-solutions/local-studio.git' }

$InstallDir = [System.IO.Path]::GetFullPath($InstallDir)
$DataDir = [System.IO.Path]::GetFullPath($DataDir)
$ModelsDir = [System.IO.Path]::GetFullPath($ModelsDir)
$TaskName = "Local Studio Controller-$Port"
$EnvFile = Join-Path $InstallDir '.env'
$RunnerFile = Join-Path $DataDir "controller-$Port.ps1"
$LogFile = Join-Path $DataDir 'controller.log'
$PidFile = Join-Path $DataDir "controller-$Port.pid"
$RunRegistryPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$RunRegistryName = "LocalStudioController$Port"
$PowerShellCommand = Get-Command pwsh.exe -ErrorAction SilentlyContinue
if (-not $PowerShellCommand) { $PowerShellCommand = Get-Command powershell.exe -ErrorAction Stop }
$TaskArguments = "-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$RunnerFile`""

function Invoke-TaskCommand {
  param([string[]]$Arguments, [switch]$AllowFailure)
  & schtasks.exe @Arguments 2>$null | Out-Null
  $succeeded = $LASTEXITCODE -eq 0
  if (-not $succeeded -and -not $AllowFailure) {
    throw "schtasks.exe failed with exit code $LASTEXITCODE"
  }
  return $succeeded
}

function Test-ScheduledTask {
  & schtasks.exe /Query /TN $TaskName 2>$null | Out-Null
  return $LASTEXITCODE -eq 0
}

function Test-StartupEntry {
  $property = Get-ItemProperty -LiteralPath $RunRegistryPath -Name $RunRegistryName -ErrorAction SilentlyContinue
  return $null -ne $property
}

function Stop-ControllerProcess {
  Invoke-TaskCommand -Arguments @('/End', '/TN', $TaskName) -AllowFailure | Out-Null
  if (Test-Path -LiteralPath $PidFile) {
    $controllerPid = [int](Get-Content -LiteralPath $PidFile -Raw)
    & taskkill.exe /PID $controllerPid /T /F 2>$null | Out-Null
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
  }
}

function Start-ControllerProcess {
  if (Test-ScheduledTask) {
    Invoke-TaskCommand -Arguments @('/Run', '/TN', $TaskName) | Out-Null
    return
  }
  if (-not (Test-StartupEntry)) { throw "Controller startup registration $TaskName was not found" }
  Start-Process -FilePath $PowerShellCommand.Source -ArgumentList $TaskArguments -WindowStyle Hidden | Out-Null
}

function Get-EnvironmentValue {
  param([string]$Name)
  if (-not (Test-Path -LiteralPath $EnvFile)) { return $null }
  $line = Get-Content -LiteralPath $EnvFile | Where-Object { $_ -match "^$([regex]::Escape($Name))=" } | Select-Object -First 1
  if (-not $line) { return $null }
  $value = $line.Substring($Name.Length + 1)
  if ($value.Length -ge 2 -and $value.StartsWith('"') -and $value.EndsWith('"')) {
    return $value.Substring(1, $value.Length - 2).Replace('\"', '"')
  }
  return $value
}

function Format-EnvironmentValue {
  param([string]$Value)
  if ($Value -match "[\r\n]") { throw 'Environment values cannot contain newlines' }
  return '"' + $Value.Replace('"', '\"') + '"'
}

function Set-EnvironmentFile {
  param([hashtable]$Values)
  $lines = [System.Collections.Generic.List[string]]::new()
  if (Test-Path -LiteralPath $EnvFile) {
    foreach ($line in Get-Content -LiteralPath $EnvFile) { $lines.Add($line) }
  }
  foreach ($key in $Values.Keys) {
    $replacement = "$key=$(Format-EnvironmentValue ([string]$Values[$key]))"
    $index = -1
    for ($position = 0; $position -lt $lines.Count; $position += 1) {
      if ($lines[$position] -match "^$([regex]::Escape($key))=") { $index = $position; break }
    }
    if ($index -ge 0) { $lines[$index] = $replacement } else { $lines.Add($replacement) }
  }
  [System.IO.File]::WriteAllLines($EnvFile, $lines, [System.Text.UTF8Encoding]::new($false))
}

function New-ApiKey {
  $bytes = [byte[]]::new(32)
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  return ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
}

function ConvertTo-SingleQuotedLiteral {
  param([string]$Value)
  return "'" + $Value.Replace("'", "''") + "'"
}

function Write-Runner {
  param([string]$BunPath)
  $install = ConvertTo-SingleQuotedLiteral $InstallDir
  $bun = ConvertTo-SingleQuotedLiteral $BunPath
  $entry = ConvertTo-SingleQuotedLiteral (Join-Path $InstallDir 'controller\src\main.ts')
  $log = ConvertTo-SingleQuotedLiteral $LogFile
  $pidPath = ConvertTo-SingleQuotedLiteral $PidFile
  $content = @(
    '$ErrorActionPreference = ''Stop''',
    '$OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '[Console]::OutputEncoding = $OutputEncoding',
    "Set-Location -LiteralPath $install",
    "[System.IO.File]::WriteAllText($pidPath, [string]`$PID, [System.Text.UTF8Encoding]::new(`$false))",
    'try {',
    "  & $bun $entry *>> $log",
    '  exit $LASTEXITCODE',
    '} finally {',
    "  Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue",
    '}'
  )
  [System.IO.File]::WriteAllLines($RunnerFile, $content, [System.Text.UTF8Encoding]::new($false))
}

function Wait-ControllerHealth {
  $healthHost = if ($HostAddress -in @('0.0.0.0', '::', '')) { '127.0.0.1' } else { $HostAddress }
  $urlHost = if ($healthHost.Contains(':')) { "[$healthHost]" } else { $healthHost }
  $url = "http://${urlHost}:$Port/health"
  for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    try {
      $response = Invoke-WebRequest -Uri $url -TimeoutSec 2 -UseBasicParsing
      if ($response.StatusCode -eq 200) { return $url }
    } catch {}
    Start-Sleep -Seconds 2
  }
  throw "Controller did not become healthy; inspect $LogFile"
}

if ($Action -eq 'Plan') {
  [ordered]@{
    taskName = $TaskName
    executable = $PowerShellCommand.Source
    arguments = $TaskArguments
    runnerPath = $RunnerFile
    environmentPath = $EnvFile
    logPath = $LogFile
    pidPath = $PidFile
    startupRegistryName = $RunRegistryName
  } | ConvertTo-Json -Compress
  exit 0
}

if ($Action -eq 'Status') {
  $mode = if (Test-ScheduledTask) { 'scheduled-task' } elseif (Test-StartupEntry) { 'startup-registry' } else { 'not-installed' }
  $running = $false
  if (Test-Path -LiteralPath $PidFile) {
    $controllerPid = [int](Get-Content -LiteralPath $PidFile -Raw)
    $running = $null -ne (Get-Process -Id $controllerPid -ErrorAction SilentlyContinue)
  }
  [ordered]@{ mode = $mode; running = $running; port = $Port; logPath = $LogFile } | ConvertTo-Json -Compress
  exit $(if ($mode -eq 'not-installed') { 1 } else { 0 })
}

if ($Action -eq 'Stop') {
  Stop-ControllerProcess
  exit 0
}

if ($Action -eq 'Remove') {
  Stop-ControllerProcess
  Invoke-TaskCommand -Arguments @('/Delete', '/F', '/TN', $TaskName) -AllowFailure | Out-Null
  Remove-ItemProperty -LiteralPath $RunRegistryPath -Name $RunRegistryName -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $RunnerFile) { Remove-Item -LiteralPath $RunnerFile -Force }
  Write-Output "Removed controller startup $TaskName; source and data were preserved"
  exit 0
}

if ($Action -in @('Start', 'Restart')) {
  if ($Action -eq 'Restart') { Stop-ControllerProcess }
  Start-ControllerProcess
  Wait-ControllerHealth | Out-Null
  Write-Output "Controller healthy on port $Port"
  exit 0
}

$GitCommand = Get-Command git.exe -ErrorAction SilentlyContinue
if (-not $GitCommand) { $GitCommand = Get-Command git -ErrorAction Stop }
$BunCommand = Get-Command bun.exe -ErrorAction SilentlyContinue
if (-not $BunCommand) { $BunCommand = Get-Command bun -ErrorAction Stop }

if (Test-Path -LiteralPath (Join-Path $InstallDir '.git')) {
  & $GitCommand.Source -C $InstallDir pull --ff-only
  if ($LASTEXITCODE -ne 0) { Write-Warning 'Git update failed; keeping the existing checkout' }
} elseif (Test-Path -LiteralPath (Join-Path $InstallDir 'controller')) {
  Write-Output "Using existing source at $InstallDir"
} else {
  New-Item -ItemType Directory -Path (Split-Path -Parent $InstallDir) -Force | Out-Null
  & $GitCommand.Source clone --depth 1 $Repo $InstallDir
  if ($LASTEXITCODE -ne 0) { throw 'Git clone failed' }
}

Push-Location (Join-Path $InstallDir 'controller')
try {
  & $BunCommand.Source install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw 'Controller dependency installation failed' }
} finally {
  Pop-Location
}

New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
New-Item -ItemType Directory -Path $ModelsDir -Force | Out-Null
$ApiKey = Get-EnvironmentValue 'LOCAL_STUDIO_API_KEY'
if (-not $ApiKey) { $ApiKey = New-ApiKey }
Set-EnvironmentFile @{
  LOCAL_STUDIO_API_KEY = $ApiKey
  LOCAL_STUDIO_HOST = $HostAddress
  LOCAL_STUDIO_PORT = [string]$Port
  LOCAL_STUDIO_DATA_DIR = $DataDir
  LOCAL_STUDIO_MODELS_DIR = $ModelsDir
}
Write-Runner $BunCommand.Source

Stop-ControllerProcess
$taskCommand = "`"$($PowerShellCommand.Source)`" $TaskArguments"
$taskCreated = Invoke-TaskCommand -Arguments @('/Create', '/F', '/SC', 'ONLOGON', '/RL', 'LIMITED', '/TN', $TaskName, '/TR', $taskCommand) -AllowFailure
if ($taskCreated) {
  Remove-ItemProperty -LiteralPath $RunRegistryPath -Name $RunRegistryName -ErrorAction SilentlyContinue
} else {
  New-Item -Path $RunRegistryPath -Force | Out-Null
  Set-ItemProperty -LiteralPath $RunRegistryPath -Name $RunRegistryName -Value $taskCommand
  Write-Warning 'Scheduled Task creation was unavailable; using the current user startup registry'
}
Start-ControllerProcess
$HealthUrl = Wait-ControllerHealth
$ControllerUrl = $HealthUrl.Substring(0, $HealthUrl.Length - '/health'.Length)
$Payload = [ordered]@{ url = $ControllerUrl; api_key = $ApiKey } | ConvertTo-Json -Compress
Write-Output "LOCAL_STUDIO_CONTROLLER $Payload"
