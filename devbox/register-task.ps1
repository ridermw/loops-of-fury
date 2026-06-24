<#
.SYNOPSIS
  Register (or refresh) the Windows Scheduled Tasks that drive the loop unattended.
  Uses Task Scheduler directly — no WSL.

.DESCRIPTION
  Creates two tasks (idempotent, -Force overwrites):
    <Prefix>-Run       launches devbox\run-loop.ps1 at startup and on a repeating
                       interval. Each launch is one bounded loop:run; the interval
                       is just how often a new bounded run is (re)started.
    <Prefix>-Watchdog  launches devbox\watchdog.ps1 every WatchdogMinutes to recover
                       a crashed or hung run (stale heartbeat -> kill + relaunch).

  Cadence by -Mode:
    Scheduled   (default)  every IntervalHours (default 6). Predictable credit spend.
    Continuous             re-checks every 5 min; the overlap lock means a new run
                           starts right after the previous one ends (max spend).
    OnDemand               tasks registered but DISABLED; you trigger runs manually.

  Tasks run with an S4U principal (no stored password, runs whether or not you are
  logged on). If S4U registration is not permitted, falls back to an Interactive
  principal (runs only while you are logged on) — re-run elevated for true headless.

.EXAMPLE
  pwsh -File devbox\register-task.ps1 -Mode Scheduled -IntervalHours 4

.EXAMPLE
  pwsh -File devbox\register-task.ps1 -Mode OnDemand        # manual triggering only
#>
[CmdletBinding()]
param(
    [ValidateSet('Scheduled','Continuous','OnDemand')][string]$Mode = 'Scheduled',
    [int]$IntervalHours = 6,
    [int]$WatchdogMinutes = 15,
    [string]$RepoPath,
    [string]$TaskPrefix = 'LoopsOfFury',
    [switch]$NoWatchdog,
    [switch]$Interactive,
    [switch]$NoElevate
)

. (Join-Path $PSScriptRoot '_common.ps1')
$ErrorActionPreference = 'Stop'

$repo      = Get-RepoRoot $RepoPath
$runScript = Join-Path $PSScriptRoot 'run-loop.ps1'
$wdScript  = Join-Path $PSScriptRoot 'watchdog.ps1'

# --- Elevation guard --------------------------------------------------------
# Task registration requires Administrator rights on a locked-down devbox. If we are
# not elevated, relaunch this same script elevated (one UAC prompt) and return — unless
# -NoElevate was passed, in which case surface a precise manual remediation.
if (-not (Test-IsElevated)) {
    $elevHint = "Open an Administrator PowerShell and run: powershell -ExecutionPolicy Bypass -File `"$PSCommandPath`" -RepoPath `"$repo`" -Mode $Mode -IntervalHours $IntervalHours"
    if ($NoElevate) { throw "Scheduled Task registration requires an elevated PowerShell. $elevHint" }
    Write-Log "Not elevated — relaunching task registration as Administrator (a UAC prompt will appear)." 'WARN'
    $selfExe = (Get-Process -Id $PID).Path
    $argList = @('-NoProfile','-ExecutionPolicy','Bypass','-File', $PSCommandPath,
                 '-NoElevate','-RepoPath', $repo, '-Mode', $Mode,
                 '-IntervalHours', $IntervalHours, '-WatchdogMinutes', $WatchdogMinutes,
                 '-TaskPrefix', $TaskPrefix)
    if ($NoWatchdog)  { $argList += '-NoWatchdog' }
    if ($Interactive) { $argList += '-Interactive' }
    try {
        $p = Start-Process -FilePath $selfExe -Verb RunAs -Wait -PassThru -ArgumentList $argList
    } catch {
        throw "Could not self-elevate: $($_.Exception.Message). $elevHint"
    }
    if ($p.ExitCode -ne 0) { throw "Elevated task registration exited with code $($p.ExitCode). See the elevated window for details. $elevHint" }
    Write-Log "Task registration completed in the elevated process." 'OK'
    return
}
$psExe     = (Get-Command powershell.exe -ErrorAction SilentlyContinue).Source
if (-not $psExe) { $psExe = (Get-Command pwsh.exe).Source }
$userId    = "$env:USERDOMAIN\$env:USERNAME"

if ($Mode -eq 'Continuous') { $interval = New-TimeSpan -Minutes 5 }
else                        { $interval = New-TimeSpan -Hours $IntervalHours }

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 9) -DontStopOnIdleEnd

function New-Principal {
    param([switch]$ForceInteractive)
    if ($ForceInteractive -or $Interactive) {
        return (New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited)
    }
    return (New-ScheduledTaskPrincipal -UserId $userId -LogonType S4U -RunLevel Limited)
}

function Register-LoopTask {
    param([string]$Name, [object]$Action, [object[]]$Triggers)
    try {
        Register-ScheduledTask -TaskName $Name -Action $Action -Trigger $Triggers `
            -Principal (New-Principal) -Settings $settings -Force | Out-Null
        Write-Log "Registered '$Name' (S4U — runs whether or not you are logged on)." 'OK'
    } catch {
        $msg = ($_.Exception.Message -replace '\s+', ' ').Trim()
        Write-Log "S4U registration of '$Name' failed: $msg. Falling back to an Interactive principal." 'WARN'
        try {
            Register-ScheduledTask -TaskName $Name -Action $Action -Trigger $Triggers `
                -Principal (New-Principal -ForceInteractive) -Settings $settings -Force | Out-Null
            Write-Log "Registered '$Name' (Interactive — runs only while you are logged on)." 'OK'
        } catch {
            $m2 = ($_.Exception.Message -replace '\s+', ' ').Trim()
            throw "Could not register '$Name'; Interactive fallback also failed: $m2. Run this from an elevated (Administrator) PowerShell."
        }
    }
}

# --- Run task ---------------------------------------------------------------
$runArg = "-NoProfile -ExecutionPolicy Bypass -File `"$runScript`" -RepoPath `"$repo`""
$runAction = New-ScheduledTaskAction -Execute $psExe -Argument $runArg -WorkingDirectory $repo
$runTriggers = @(
    (New-ScheduledTaskTrigger -AtStartup),
    (New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(2)) -RepetitionInterval $interval)
)
$runName = "$TaskPrefix-Run"
Register-LoopTask -Name $runName -Action $runAction -Triggers $runTriggers

if ($Mode -eq 'OnDemand') {
    Disable-ScheduledTask -TaskName $runName | Out-Null
    Write-Log "'$runName' registered DISABLED (OnDemand). Trigger manually: Start-ScheduledTask -TaskName '$runName'." 'WARN'
} else {
    Write-Log "'$runName' cadence: $Mode (every $([math]::Round($interval.TotalMinutes)) min)." 'OK'
}

# --- Watchdog task ----------------------------------------------------------
if ($NoWatchdog) {
    Write-Log "Skipping watchdog task (-NoWatchdog)." 'WARN'
} else {
    $wdArg = "-NoProfile -ExecutionPolicy Bypass -File `"$wdScript`" -RepoPath `"$repo`" -StaleMinutes $WatchdogMinutes"
    $wdAction = New-ScheduledTaskAction -Execute $psExe -Argument $wdArg -WorkingDirectory $repo
    $wdTriggers = @(
        (New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(5)) -RepetitionInterval (New-TimeSpan -Minutes $WatchdogMinutes))
    )
    $wdName = "$TaskPrefix-Watchdog"
    Register-LoopTask -Name $wdName -Action $wdAction -Triggers $wdTriggers
    if ($Mode -eq 'OnDemand') { Disable-ScheduledTask -TaskName $wdName | Out-Null; Write-Log "'$wdName' registered DISABLED (OnDemand)." 'WARN' }
}

Write-Log "Done. Inspect: Get-ScheduledTask -TaskName '$TaskPrefix-*'. Remove: Unregister-ScheduledTask -TaskName '$TaskPrefix-*'." 'OK'
