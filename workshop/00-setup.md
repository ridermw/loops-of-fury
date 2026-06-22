# 00 - Setup

## Goal

Make sure everyone can run the starter repo and see the same failing tests.

## Steps

Fork the instructor repo into your own GitHub account, then clone your fork:

```bash
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
