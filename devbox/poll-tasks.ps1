<#
.SYNOPSIS
  Low-latency waker — start a bounded loop run promptly when a maintainer enqueues a
  `loop-task` issue, instead of waiting for the next scheduled run.

.DESCRIPTION
  The loop drains the `loop-task` queue ONCE at the start of each bounded run (its intake
  phase, before the autonomous weakest-axis polish). So with only a periodic Run task, a
  freshly labeled issue waits until the next scheduled run begins — up to IntervalHours.

  This poller closes that idle gap and spends ZERO AI credits: on each tick it only asks
  the GitHub API whether any actionable open `loop-task` issue exists (one not already
  flagged `loop-needs-review`, mirroring the engine's own intake eligibility). If one does
  AND no run is currently active, it triggers the existing Run Scheduled Task — which syncs
  to origin and runs one bounded loop:run, whose intake phase then drains the queue. When
  the queue is empty (or a run is already active) the poller is a no-op, so idle credit
  spend is identical to the scheduled-only setup.

  It triggers the registered Run task (rather than launching run-loop.ps1 directly) so it
  reuses that task's principal + working directory and lets Task Scheduler's
  MultipleInstances=IgnoreNew guarantee a single Run instance — no lock race.

  NOTE: while a run is mid-flight its intake has already drained, so a brand-new issue is
  picked up by the NEXT run once the active one ends — never longer than one bounded run.
#>
[CmdletBinding()]
param(
    [string]$RepoPath,
    [string]$RunTaskName      = 'LoopsOfFury-Run',
    [string]$TaskLabel        = 'loop-task',
    [string]$NeedsReviewLabel = 'loop-needs-review',
    [int]$StaleMinutes        = 15
)

. (Join-Path $PSScriptRoot '_common.ps1')

$repo   = Get-RepoRoot $RepoPath
$logDir = Get-DevboxLogDir $repo
$log    = Join-Path $logDir 'poll.log'
Set-Location $repo

# --- 1. A run already active? then the poller is a no-op. The overlap lock would block a
#        second run anyway, and the active run's successor drains any new issue. ---------
$lock = Get-RunLock $repo
if ($lock) {
    $loopPid = if ($lock.PSObject.Properties['loopPid']) { [int]$lock.loopPid } else { 0 }
    if ((Test-ProcessAlive $loopPid) -and ((Get-HeartbeatAgeMinutes $repo) -le $StaleMinutes)) {
        return
    }
}

# --- 2. Token for the API query (same source as run-loop.ps1) --------------------------
Import-DotEnv (Join-Path $repo '.loop\.env') | Out-Null
if (-not $env:GH_TOKEN -and -not $env:GITHUB_TOKEN) {
    Write-Log "No GH_TOKEN/GITHUB_TOKEN in .loop\.env — cannot check for '$TaskLabel' issues." 'WARN' $log
    return
}
if (-not (Test-Command 'gh')) { Write-Log "'gh' not found — cannot poll for tasks." 'WARN' $log; return }

# --- 3. Cheap, no-AI check: is any ACTIONABLE open loop-task issue waiting? -------------
# Mirror intake's eligibility (intake.mjs selectTask): open, labeled loop-task, and NOT
# already loop-needs-review (those are owned by a human, so waking a run would just spin).
$search = "is:open label:$TaskLabel -label:$NeedsReviewLabel"
$raw = & gh issue list --search $search --json number --limit 1 2>> $log
if ($LASTEXITCODE -ne 0) { Write-Log "gh issue list failed (exit $LASTEXITCODE)." 'WARN' $log; return }
$open = @()
try { $open = @($raw | ConvertFrom-Json) } catch { $open = @() }
if ($open.Count -lt 1) { return }   # empty queue → no run, no spend

# --- 4. Wake a bounded run via the registered Run task (IgnoreNew dedupes) --------------
$task = Get-ScheduledTask -TaskName $RunTaskName -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Log "Run task '$RunTaskName' not registered — run devbox\register-task.ps1." 'WARN' $log
    return
}
try {
    Start-ScheduledTask -TaskName $RunTaskName -ErrorAction Stop
    Write-Log "Open '$TaskLabel' issue waiting — triggered '$RunTaskName' for a bounded run." 'OK' $log
} catch {
    Write-Log "Could not start '$RunTaskName': $(($_.Exception.Message -replace '\s+',' ').Trim())" 'WARN' $log
}
