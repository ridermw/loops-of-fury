# 00 - Setup

## Goal

Make sure everyone can run the starter repo and see the same failing tests.

## Steps

Fork the instructor repo into your own GitHub account, then clone your fork:

```powershell
gh repo fork ridermw/loops-of-fury --clone=true
cd loops-of-fury
npm test
```

Expected result: the test suite fails. That is intentional.

## Ground rules

- Do not edit tests unless the facilitator explicitly says so.
- Do not copy the solution file during the lab.
- Use Copilot CLI as the agent, but keep the human responsible for verification.
- Every task needs a done-condition before the maker starts.

## Done-condition for setup

You can run `npm test` and see failures related to inventory behavior.

## Windows notes

- Run commands from PowerShell or Windows Terminal.
- If PowerShell blocks `scripts\run-checks.ps1`, use `npm test` or `scripts\run-checks.cmd` instead.
- Paths in the workshop use forward slashes in docs, but PowerShell accepts them for Git and Node commands.
