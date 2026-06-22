# 03 - Check with a verifier

## Goal

Use a separate checker prompt to review the maker's work.

## Done-condition

The checker returns either:

- `PASS`, with evidence from tests and a scoped diff; or
- `FAIL`, with specific evidence and the next fix request.

## Suggested prompt

Open a fresh Copilot CLI session or ask for a separate review role, then paste `prompts/copilot-cli/03-checker-review.md`.

## Discussion

The checker should not merely agree with the maker. It should verify:

- Tests pass.
- The test suite was not weakened.
- The fix is not hardcoded.
- Idempotency is handled safely.
- Backorder quantities are correct.

