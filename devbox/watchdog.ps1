<#
.SYNOPSIS
  Crash/hang recovery for the unattended loop. Invoked on a short interval by the
  <Prefix>-Watchdog Scheduled Task.

.DESCRIPTION
  Reads the devbox run lock and the engine's own heartbeat (.loop\run.json). The
  engine writes heartbeatMs continuously while running and marks run.json status
  'ended' on a clean stop; LOOP.heartbeatTtlMs (15 min, D34) is the staleness floor.

  Decision table (lock present):
    loop process dead              -> clear the stale lock; relaunch (unless -NoRelaunch)
    process alive + heartbeat stale-> kill the hung run (Stop-Process -Id); relaunch
    process alive + heartbeat fresh-> healthy; do nothing
  No lock present:
    nothing to supervise — starting new runs on cadence is the Scheduled Task's job,
    not the watchdog's. (Use -StartIfIdle to also kick a run when none is active.)

.EXAMPLE
  pwsh -File devbox\watchdog.ps1 -StaleMinutes 15
#>
[CmdletBinding()]
param(
    [string]$RepoPath,
    [int]$StaleMinutes = 15,
    [switch]$NoRelaunch,
    [switch]$StartIfIdle
)

. (Join-Path $PSScriptRoot '_common.ps1')

$repo = Get-RepoRoot $RepoPath
$log  = Join-Path (Get-DevboxLogDir $repo) 'watchdog.log'

function Start-RunLoop {
    $psExe = (Get-Command powershell.exe -ErrorAction SilentlyContinue).Source
    if (-not $psExe) { $psExe = (Get-Command pwsh.exe).Source }
    $runScript = Join-Path $PSScriptRoot 'run-loop.ps1'
    Start-Process -FilePath $psExe -WindowStyle Hidden -WorkingDirectory $repo `
        -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File', $runScript, '-RepoPath', $repo) | Out-Null
    Write-Log "Relaunched run-loop.ps1." 'OK' $log
}

$lock = Get-RunLock $repo
if (-not $lock) {
    if ($StartIfIdle) {
        Write-Log "No active run and -StartIfIdle set — launching a run." 'INFO' $log
        if (-not $NoRelaunch) { Start-RunLoop }
    } else {
        Write-Log "No active run lock; nothing to supervise." 'INFO' $log
    }
    return
}

$loopPid = if ($lock.PSObject.Properties['loopPid']) { [int]$lock.loopPid } else { 0 }
$alive   = Test-ProcessAlive $loopPid
$ageMin  = [math]::Round((Get-HeartbeatAgeMinutes $repo), 1)

if (-not $alive) {
    Write-Log "Loop pid $loopPid not alive but lock present — clearing stale lock." 'WARN' $log
    Remove-RunLock $repo
    if (-not $NoRelaunch) { Start-RunLoop }
    return
}

if ($ageMin -gt $StaleMinutes) {
    Write-Log "Heartbeat stale (${ageMin}min > ${StaleMinutes}min) with pid $loopPid alive — killing hung run." 'ERROR' $log
    try { Stop-Process -Id $loopPid -Force -ErrorAction Stop } catch { Write-Log "Stop-Process failed: $($_.Exception.Message)" 'WARN' $log }
    Remove-RunLock $repo
    if (-not $NoRelaunch) { Start-RunLoop }
    return
}

Write-Log "Run healthy (pid $loopPid, heartbeat ${ageMin}min)." 'OK' $log
