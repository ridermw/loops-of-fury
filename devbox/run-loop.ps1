<#
.SYNOPSIS
  Run exactly one bounded loop:run on the devbox. The scheduled-task entrypoint.

.DESCRIPTION
  A single `npm run loop:run` is self-terminating: it stops at the 8-hour hard cap,
  after maxNoops consecutive no-ops, or on a churn escalation (see .loop\config.mjs
  LOOP). "Unattended forever" is therefore: this script, invoked repeatedly by a
  Scheduled Task, plus watchdog.ps1 for crash/hang recovery.

  Each invocation:
    1. Takes an exclusive lock so runs never overlap (and clears a stale/dead lock).
    2. Loads GH_TOKEN from .loop\.env.
    3. Syncs the working tree to origin/<branch> (the loop self-commits run-state,
       so origin is the source of truth). -NoReset uses a fast-forward pull instead.
    4. Runs loop:preflight and ABORTS the run if the safety gate is not ok.
    5. Launches `node .loop\loop.mjs --run` as a tracked child (PID recorded in the
       lock so the watchdog can kill a hung run), tees output to devbox\logs, and
       waits for it to finish.

  Exit code mirrors loop:run (or 0 on a clean overlap-skip, non-zero on preflight fail).
#>
[CmdletBinding()]
param(
    [string]$RepoPath,
    [string]$Branch = 'main',
    [switch]$NoReset,
    [switch]$SkipPreflight,
    [int]$StaleMinutes = 15
)

. (Join-Path $PSScriptRoot '_common.ps1')

$repo   = Get-RepoRoot $RepoPath
$logDir = Get-DevboxLogDir $repo
$stamp  = (Get-Date).ToString('yyyyMMdd-HHmmss')
$log    = Join-Path $logDir "run-$stamp.log"
$history= Join-Path $logDir 'history.log'
Set-Location $repo

Write-Log "run-loop start (repo=$repo, branch=$Branch)" 'INFO' $log

# --- 1. Overlap / stale-lock handling --------------------------------------
$lock = Get-RunLock $repo
if ($lock) {
    $loopPid = if ($lock.PSObject.Properties['loopPid']) { [int]$lock.loopPid } else { 0 }
    $alive   = Test-ProcessAlive $loopPid
    $ageMin  = Get-HeartbeatAgeMinutes $repo
    if ($alive -and $ageMin -le $StaleMinutes) {
        Write-Log "Another run is active (pid $loopPid, heartbeat ${ageMin}min). Skipping." 'WARN' $log
        Add-Content $history "[$stamp] SKIP (overlap, pid $loopPid)" -Encoding utf8
        exit 0
    }
    Write-Log "Found stale lock (pid $loopPid, alive=$alive, heartbeat ${ageMin}min). Reclaiming." 'WARN' $log
    if ($alive) { try { Stop-Process -Id $loopPid -Force -ErrorAction Stop } catch { Write-Log $_.Exception.Message 'WARN' $log } }
    Remove-RunLock $repo
}

# --- 2. Secrets -------------------------------------------------------------
Import-DotEnv (Join-Path $repo '.loop\.env') | Out-Null
if (-not $env:GH_TOKEN -and -not $env:GITHUB_TOKEN) {
    Write-Log "No GH_TOKEN/GITHUB_TOKEN — push, the loop-run issue, and Pages verify will fail." 'WARN' $log
}

# --- 3. Sync to origin ------------------------------------------------------
& git fetch origin --prune *>> $log
if ($LASTEXITCODE -ne 0) { Write-Log "git fetch failed (exit $LASTEXITCODE)." 'ERROR' $log; Add-Content $history "[$stamp] FAIL (git fetch)" -Encoding utf8; exit 1 }

if ($NoReset) {
    & git pull --ff-only origin $Branch *>> $log
    if ($LASTEXITCODE -ne 0) { Write-Log "git pull --ff-only failed; working tree diverged. Use a clean reset or resolve manually." 'ERROR' $log; Add-Content $history "[$stamp] FAIL (git pull)" -Encoding utf8; exit 1 }
} else {
    # Clean control plane each run. .loop\.env, devbox\logs, devbox\state, node_modules
    # are all gitignored and survive a hard reset (we deliberately do NOT git clean).
    & git checkout $Branch *>> $log
    & git reset --hard "origin/$Branch" *>> $log
    if ($LASTEXITCODE -ne 0) { Write-Log "git reset --hard origin/$Branch failed (exit $LASTEXITCODE)." 'ERROR' $log; Add-Content $history "[$stamp] FAIL (git reset)" -Encoding utf8; exit 1 }
}

# --- 3b. Automation self-update awareness -----------------------------------
# The sync above already brought the latest .loop engine + devbox scripts to disk, so THIS
# bounded run executes current engine code. The Scheduled Task DEFINITIONS, however, are
# Task Scheduler objects a pull cannot reshape — only register-task.ps1 can. If the
# task-shaping scripts changed on origin since we last registered, warn the operator to
# re-run bootstrap (elevated) so cadence/triggers/tasks pick up the change. Best-effort;
# never blocks the run.
try {
    $regFile = Join-Path (Get-DevboxStateDir $repo) 'registered.json'
    if (Test-Path $regFile) {
        $reg = Get-Content $regFile -Raw | ConvertFrom-Json
        $cur = & git log -1 --format=%H -- devbox/register-task.ps1 devbox/run-loop.ps1 devbox/poll-tasks.ps1 devbox/watchdog.ps1 devbox/_common.ps1 2>$null
        if ($cur -and $reg.commit -and ($cur.Trim() -ne $reg.commit)) {
            Write-Log ("Devbox automation changed on origin since last registration ({0} -> {1}). Re-run devbox\bootstrap.ps1 (elevated) to refresh the Scheduled Task definitions." -f $reg.commit.Substring(0,7), $cur.Trim().Substring(0,7)) 'WARN' $log
        }
    }
} catch { }

# --- 4. Safety gate ---------------------------------------------------------
if (-not $SkipPreflight) {
    & node .loop\loop.mjs --preflight *>> $log
    if ($LASTEXITCODE -ne 0) {
        Write-Log "loop:preflight NOT ok (exit $LASTEXITCODE). Refusing to run." 'ERROR' $log
        Add-Content $history "[$stamp] ABORT (preflight not ok)" -Encoding utf8
        exit 1
    }
    Write-Log "preflight ok." 'OK' $log
}

# --- 5. The bounded run -----------------------------------------------------
$outLog = Join-Path $logDir "loop-$stamp.out.log"
$errLog = Join-Path $logDir "loop-$stamp.err.log"
Write-Log "Launching node .loop\loop.mjs --run (output -> $outLog)" 'INFO' $log

$proc = Start-Process -FilePath 'node' `
    -ArgumentList '.loop\loop.mjs','--run' `
    -WorkingDirectory $repo -PassThru -NoNewWindow `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog
New-RunLock -RepoPath $repo -LoopPid $proc.Id | Out-Null
Write-Log "loop pid $($proc.Id) running; waiting (cap 8h)." 'INFO' $log

$proc | Wait-Process
$code = if ($null -ne $proc.ExitCode) { [int]$proc.ExitCode } else { 0 }
Remove-RunLock $repo

if ((Test-Path $errLog) -and (Get-Item $errLog).Length -gt 0) {
    Add-Content $log "----- stderr -----" -Encoding utf8
    Get-Content $errLog | Add-Content $log -Encoding utf8
}

$result = if ($code -eq 0) { 'OK' } else { "EXIT $code" }
$level  = if ($code -eq 0) { 'OK' } else { 'ERROR' }
Write-Log "loop:run finished ($result)." $level $log
Add-Content $history "[$stamp] DONE ($result, pid $($proc.Id))" -Encoding utf8
exit $code
