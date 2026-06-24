<#
.SYNOPSIS
  One-time provisioning for a fresh Windows cloud devbox (no WSL) to run the
  Loops of Fury self-improvement loop unattended.

.DESCRIPTION
  Idempotent. Verifies/installs prerequisites, prepares the repo, captures the
  control baseline, and (by default) registers the Scheduled Tasks that keep the
  loop running. Safe to re-run.

  Steps:
    1. Verify Node >= 20 (engines.node), git, gh, and the copilot CLI (the maker).
    2. Clone or update the repo.
    3. Ensure .loop\.env exists (template created if missing) and load GH_TOKEN.
    4. Authenticate git for non-interactive push via `gh auth setup-git`.
    5. npm ci  ->  npx playwright install chromium  (the checker renders headless).
    6. npm run loop:install-hooks   (pre-push barrier, D30).
    7. npm run loop:init            (capture anchor/slide baseline + pin manifest).
    8. npm run loop:preflight       (sanity gate).
    9. Register the run + watchdog Scheduled Tasks (unless -SkipTaskRegister).

.NOTES
  No secrets are stored in this script. The GitHub token is read at runtime from
  <repo>\.loop\.env (gitignored). A real loop run drives the `copilot` maker
  (~80 AI credits per landed iteration), so this is a deliberate, owner-gated spend.

.EXAMPLE
  # From inside a clone:
  pwsh -ExecutionPolicy Bypass -File devbox\bootstrap.ps1

.EXAMPLE
  # On a bare devbox, cloning fresh and running every 4 hours:
  pwsh -File bootstrap.ps1 -RepoPath C:\loops-of-fury -Mode Scheduled -IntervalHours 4
#>
[CmdletBinding()]
param(
    [string]$RepoUrl = 'https://github.com/ridermw/loops-of-fury.git',
    [string]$RepoPath,
    [string]$Branch = 'main',
    [ValidateSet('Scheduled','Continuous','OnDemand')][string]$Mode = 'Scheduled',
    [int]$IntervalHours = 6,
    [switch]$SkipTaskRegister,
    [switch]$SkipPlaywright
)

. (Join-Path $PSScriptRoot '_common.ps1')
$ErrorActionPreference = 'Stop'

function Invoke-Native {
    param([Parameter(Mandatory)][string]$What, [Parameter(Mandatory)][scriptblock]$Body)
    Write-Log "-> $What" 'INFO'
    & $Body
    if ($LASTEXITCODE -ne 0) { throw "$What failed (exit $LASTEXITCODE)" }
}

Write-Log "Loops of Fury devbox bootstrap starting." 'OK'

# --- 1. Prerequisites -------------------------------------------------------
$nodeMajor = Get-NodeMajor
if ($nodeMajor -lt 20) {
    Write-Log "Node >= 20 required (found major '$nodeMajor')." 'WARN'
    if (Test-Command 'winget') {
        Invoke-Native 'winget install Node.js LTS' { winget install --silent --accept-package-agreements --accept-source-agreements -e --id OpenJS.NodeJS.LTS }
        Write-Log "Node installed. Open a NEW shell so PATH refreshes, then re-run bootstrap." 'WARN'
        return
    }
    throw "Install Node.js >= 20 from https://nodejs.org/ (or via winget: OpenJS.NodeJS.LTS), then re-run."
}
Write-Log "Node major version $nodeMajor OK." 'OK'

foreach ($t in @(
    @{ n='git';     hint='https://git-scm.com/download/win' },
    @{ n='gh';      hint='https://cli.github.com/  (needed for issues + Pages verify + push auth)' },
    @{ n='copilot'; hint='GitHub Copilot CLI — this IS the maker (MAKER.bin=copilot). Install + authenticate it.' }
)) {
    if (Test-Command $t.n) { Write-Log "Found '$($t.n)'." 'OK' }
    else { Write-Log "Missing '$($t.n)'  ->  $($t.hint)" 'ERROR' }
}
if (-not (Test-Command 'git')) { throw "git is required." }
if (-not (Test-Command 'gh'))  { throw "gh (GitHub CLI) is required for push auth, the loop-run issue, and live Pages verification." }
if (-not (Test-Command 'copilot')) {
    Write-Log "copilot CLI not found — the loop will run but the MAKER cannot edit (every iteration no-ops). Install/auth it before real runs." 'WARN'
}

# --- 2. Repo ----------------------------------------------------------------
$repo = if ($RepoPath) { $RepoPath } else { Split-Path -Parent $PSScriptRoot }
if (-not (Test-Path (Join-Path $repo 'package.json'))) {
    if (-not $RepoPath) { $repo = 'C:\loops-of-fury' }
    if (-not (Test-Path (Join-Path $repo 'package.json'))) {
        Write-Log "Cloning $RepoUrl -> $repo" 'INFO'
        Invoke-Native 'git clone' { git clone $RepoUrl $repo }
    }
}
$repo = (Resolve-Path $repo).Path
Set-Location $repo
Write-Log "Repo: $repo" 'OK'
Invoke-Native 'git fetch' { git fetch origin --prune }
Invoke-Native "git checkout $Branch" { git checkout $Branch }
Invoke-Native 'git pull (ff-only)' { git pull --ff-only origin $Branch }

# --- 3. Secrets (.loop\.env, gitignored) ------------------------------------
$envFile = Join-Path $repo '.loop\.env'
if (-not (Test-Path $envFile)) {
    @(
        '# Loops of Fury devbox secrets (gitignored by .gitignore). DO NOT COMMIT.',
        '# A classic/fine-grained GitHub token with contents:write + issues:write on',
        '# ridermw/loops-of-fury. The loop uses gh (issues, Pages API) and git push.',
        'GH_TOKEN=',
        '# Some tooling reads GITHUB_TOKEN instead; mirror it if needed.',
        '# GITHUB_TOKEN=',
        '',
        '# Run mode. The devbox exists to run REAL loops unattended, so enable the copilot',
        '# maker and autonomous commit+push. WITHOUT LOOP_MAKER=copilot the engine uses a',
        '# no-op maker and every run is an instant no-op (a ~2s "finished OK" that edits',
        '# nothing). Set LOOP_COMMIT=0 for a dry run (real edits + local gates, no push).',
        'LOOP_MAKER=copilot',
        'LOOP_COMMIT=1'
    ) | Set-Content -Path $envFile -Encoding utf8
    Write-Log "Created template $envFile — set GH_TOKEN before the first real run." 'WARN'
}

# Ensure the REAL-run toggles exist even in a pre-existing .env (e.g. one created before
# this kit enabled the maker). They are config toggles, not secrets. Append only when a key
# is entirely absent, so an operator's explicit choice (e.g. LOOP_COMMIT=0) is never lost.
$envText = Get-Content $envFile -Raw
$added = @()
foreach ($kv in @(@('LOOP_MAKER','copilot'), @('LOOP_COMMIT','1'))) {
    if ($envText -notmatch ("(?m)^\s*{0}\s*=" -f $kv[0])) {
        Add-Content -Path $envFile -Value ("{0}={1}" -f $kv[0], $kv[1]) -Encoding utf8
        $added += ("{0}={1}" -f $kv[0], $kv[1])
    }
}
if ($added.Count) {
    Write-Log ("Enabled real unattended runs in .loop\.env: " + ($added -join ', ') + " (set LOOP_COMMIT=0 for a no-push dry run).") 'OK'
}

Import-DotEnv $envFile | Out-Null
if (-not $env:GH_TOKEN -and -not $env:GITHUB_TOKEN) {
    Write-Log "No GH_TOKEN/GITHUB_TOKEN in .loop\.env yet — issues, Pages verify, and push will fail until set." 'WARN'
}

# --- 4. git push auth via gh ------------------------------------------------
if ($env:GH_TOKEN -or $env:GITHUB_TOKEN) {
    & gh auth status 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Log "gh not authenticated; logging in with token from .loop\.env." 'INFO'
        $tok = if ($env:GH_TOKEN) { $env:GH_TOKEN } else { $env:GITHUB_TOKEN }
        $tok | & gh auth login --with-token
    }
    Invoke-Native 'gh auth setup-git' { gh auth setup-git }
} else {
    Write-Log "Skipping gh auth setup-git (no token yet). Re-run bootstrap after filling .loop\.env." 'WARN'
}

# --- 5. Dependencies + headless browser -------------------------------------
Invoke-Native 'npm ci' { npm ci }
if (-not $SkipPlaywright) {
    Invoke-Native 'playwright install chromium' { npx --yes playwright install chromium }
} else {
    Write-Log "Skipping Playwright Chromium install (-SkipPlaywright) — renders will fail without it." 'WARN'
}

# --- 6/7/8. Hooks, baseline, sanity gate ------------------------------------
Invoke-Native 'loop:install-hooks' { npm run loop:install-hooks }
Invoke-Native 'loop:init'          { npm run loop:init }
& npm run loop:preflight
if ($LASTEXITCODE -ne 0) {
    Write-Log "loop:preflight reported not-ok (exit $LASTEXITCODE). Resolve before enabling scheduled runs." 'WARN'
} else {
    Write-Log "loop:preflight OK." 'OK'
}

# --- 9. Scheduled Tasks -----------------------------------------------------
if ($SkipTaskRegister) {
    Write-Log "Skipping task registration (-SkipTaskRegister). Register later with devbox\register-task.ps1." 'WARN'
} else {
    try {
        & (Join-Path $PSScriptRoot 'register-task.ps1') -RepoPath $repo -Mode $Mode -IntervalHours $IntervalHours
    } catch {
        $m = ($_.Exception.Message -replace '\s+', ' ').Trim()
        Write-Log "Task registration did not complete: $m" 'WARN'
        Write-Log "The repo is fully provisioned. Finish from an Administrator PowerShell: powershell -ExecutionPolicy Bypass -File devbox\register-task.ps1 -RepoPath `"$repo`" -Mode $Mode -IntervalHours $IntervalHours" 'WARN'
        Write-Log "Or run one bounded loop now without any scheduling: powershell -ExecutionPolicy Bypass -File devbox\run-loop.ps1 -RepoPath `"$repo`"" 'INFO'
    }
}

Write-Log "Bootstrap complete. Mode=$Mode. Logs: devbox\logs. Trigger one now: devbox\run-loop.ps1 -RepoPath `"$repo`"" 'OK'
