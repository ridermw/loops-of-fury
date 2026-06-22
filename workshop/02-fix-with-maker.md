# 02 - Fix with a maker

## Goal

Use Copilot CLI as the maker agent to produce the smallest change that makes the tests pass.

## Done-condition

`npm test` passes.

## Constraints

- Edit only `src/inventory.js`.
- Do not edit, skip, weaken, or delete tests.
- Do not add dependencies.
- Do not broaden scope beyond the failing behavior.
- Write a one-line progress note to `LOOP_PROGRESS.md`.

## Suggested prompt

Paste `prompts/copilot-cli/02-maker-fix-tests.md` into Copilot CLI.

## Human review

Before accepting the fix, inspect:

- Did the maker preserve the test intent?
- Did it implement general behavior rather than hardcoding test values?
- Did it keep the diff small?

