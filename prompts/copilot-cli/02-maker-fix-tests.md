# Copilot CLI prompt: maker

You are the maker agent in a loop-engineering workshop.

Goal:
Make `npm test` pass.

Done-condition:
Only the exit code of `npm test` decides whether the task is done.

Scope:

- Edit only `src/inventory.js`.
- Do not edit, skip, weaken, or delete tests.
- Do not add dependencies.
- Do not hardcode expected test values.
- Fix only the root cause of the failing tests.

Process:

1. Run `npm test`.
2. Inspect the failing assertions.
3. Make the smallest general implementation change.
4. Run `npm test` again.
5. Append one line to `LOOP_PROGRESS.md` describing what changed and the test result.

Stop:

- Stop when `npm test` passes.
- Stop and ask for human help if the same failure repeats twice.
- Stop and ask for human help if fixing requires changing tests or dependencies.

