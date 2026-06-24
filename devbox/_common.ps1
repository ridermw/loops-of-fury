# devbox/_common.ps1 — shared helpers for the Loops of Fury Windows devbox automation.
#
# Dot-sourced by bootstrap.ps1, run-loop.ps1, register-task.ps1, and watchdog.ps1.
# Windows PowerShell 5.1+ / PowerShell 7+, no WSL. No secrets live here: GitHub tokens
# are read at runtime from <repo>\.loop\.env (which is gitignored).

$script:DevboxDir = $PSScriptRoot
$script:RepoRoot  = Split-Path -Parent $PSScriptRoot

function Get-RepoRoot {
    param([string]$RepoPath)
    if ($RepoPath) {
        if (Test-Path $RepoPath) { return (Resolve-Path $RepoPath).Path }
        return $RepoPath
    }
    return $script:RepoRoot
}

function Get-DevboxStateDir {
    param([string]$RepoPath)
    $dir = Join-Path (Get-RepoRoot $RepoPath) 'devbox\state'
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    return $dir
}

function Get-DevboxLogDir {
    param([string]$RepoPath)
    $dir = Join-Path (Get-RepoRoot $RepoPath) 'devbox\logs'
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    return $dir
}

function Write-Log {
    param(
        [Parameter(Mandatory)][string]$Message,
        [ValidateSet('INFO','WARN','ERROR','OK')][string]$Level = 'INFO',
        [string]$LogFile
    )
    $line = "[{0}] [{1}] {2}" -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $Level, $Message
    switch ($Level) {
        'ERROR' { Write-Host $line -ForegroundColor Red }
        'WARN'  { Write-Host $line -ForegroundColor Yellow }
        'OK'    { Write-Host $line -ForegroundColor Green }
        default { Write-Host $line }
    }
    if ($LogFile) { Add-Content -Path $LogFile -Value $line -Encoding utf8 }
}

# Load KEY=VALUE pairs from a .env file into the current process environment.
# Lines starting with # and blank lines are ignored; surrounding quotes are stripped.
function Import-DotEnv {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path $Path)) { return $false }
    foreach ($raw in (Get-Content -Path $Path)) {
        $line = $raw.Trim()
        if ($line -eq '' -or $line.StartsWith('#')) { continue }
        $idx = $line.IndexOf('=')
        if ($idx -lt 1) { continue }
        $key = $line.Substring(0, $idx).Trim()
        $val = $line.Substring($idx + 1).Trim()
        if ($val.Length -ge 2 -and
            (($val.StartsWith('"') -and $val.EndsWith('"')) -or
             ($val.StartsWith("'") -and $val.EndsWith("'")))) {
            $val = $val.Substring(1, $val.Length - 2)
        }
        [System.Environment]::SetEnvironmentVariable($key, $val, 'Process')
    }
    return $true
}

function Test-Command {
    param([Parameter(Mandatory)][string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

# True when the current process is running with Administrator rights. Scheduled Task
# registration (S4U principal, AtStartup trigger, root \ task folder) needs this on a
# locked-down devbox; without it Register-ScheduledTask fails with "Access is denied."
function Test-IsElevated {
    try {
        $id = [System.Security.Principal.WindowsIdentity]::GetCurrent()
        $wp = New-Object System.Security.Principal.WindowsPrincipal($id)
        return $wp.IsInRole([System.Security.Principal.WindowsBuiltinRole]::Administrator)
    } catch { return $false }
}

function Get-NodeMajor {
    if (-not (Test-Command 'node')) { return 0 }
    $v = (& node -v) 2>$null
    if ($v -match 'v(\d+)') { return [int]$Matches[1] }
    return 0
}

function Get-LockFile {
    param([string]$RepoPath)
    return (Join-Path (Get-DevboxStateDir $RepoPath) 'run.lock')
}

function Get-RunLock {
    param([string]$RepoPath)
    $lf = Get-LockFile $RepoPath
    if (-not (Test-Path $lf)) { return $null }
    try { return (Get-Content $lf -Raw | ConvertFrom-Json) } catch { return $null }
}

function New-RunLock {
    param([string]$RepoPath, [int]$LoopPid = 0)
    $lf = Get-LockFile $RepoPath
    $obj = [ordered]@{
        pid       = $PID
        loopPid   = $LoopPid
        startedAt = (Get-Date).ToString('o')
        host      = $env:COMPUTERNAME
    }
    ($obj | ConvertTo-Json -Compress) | Set-Content -Path $lf -Encoding utf8
    return $lf
}

function Remove-RunLock {
    param([string]$RepoPath)
    $lf = Get-LockFile $RepoPath
    if (Test-Path $lf) { Remove-Item $lf -Force -ErrorAction SilentlyContinue }
}

function Test-ProcessAlive {
    param([int]$ProcessId)
    if ($ProcessId -le 0) { return $false }
    return [bool](Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

# Minutes since the loop heartbeat in run.json. Returns [double]::MaxValue when the
# run-state is missing or unparseable (treated as "infinitely stale" by the watchdog).
function Get-HeartbeatAgeMinutes {
    param([string]$RepoPath)
    $runJson = Join-Path (Get-RepoRoot $RepoPath) '.loop\run.json'
    if (-not (Test-Path $runJson)) { return [double]::MaxValue }
    try { $run = Get-Content $runJson -Raw | ConvertFrom-Json } catch { return [double]::MaxValue }
    $hb = $run.PSObject.Properties['heartbeatMs']
    if (-not $hb -or -not $hb.Value) { return [double]::MaxValue }
    $hbUtc = [DateTimeOffset]::FromUnixTimeMilliseconds([long]$hb.Value).UtcDateTime
    return ((Get-Date).ToUniversalTime() - $hbUtc).TotalMinutes
}
