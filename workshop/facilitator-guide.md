# Facilitator Guide

## Recommended timing

| Segment | Timebox | Notes |
|---|---:|---|
| Setup | 10 min | Make sure everyone sees failing tests. |
| Concept framing | 10 min | Prompt -> context -> harness -> loop. |
| Lab 1: Orient | 10 min | Do not allow edits yet. |
| Lab 2: Maker | 15 min | Fix only `src/inventory.js`. |
| Lab 3: Checker | 10 min | Run a separate review prompt. |
| Lab 4: Loop contract | 15 min | Convert the workflow into a contract. |
| Lab 5: Adaptation | 10 min | Pick real team use cases. |

## Facilitation script

Open with:

> Today is not about asking Copilot to fix a bug. It is about designing a safe loop around repeated agent work.

Emphasize:

- The test command is the done-condition.
- The maker does not decide done.
- The checker must show evidence.
- The loop must stop for an honest reason.

## Expected failure themes

Participants should discover these implementation bugs:

- SKU normalization does not convert spaces or underscores to hyphens.
- Blank SKUs are not rejected.
- Partial reservations lose the reserved quantity.
- Retried reservation IDs are not idempotent.
- Backorder summaries report requested quantity instead of shortage.

## Solution reference

Use `solutions/inventory.solution.js` only if a group is stuck or for post-lab review.

## Debrief questions

1. What was the machine-checkable done-condition?
2. What did the maker get right or wrong?
3. What did the checker catch that the maker did not?
4. What would make this unsafe as an unattended loop?
5. Which real team workflow has enough recurrence and verification to justify a loop?

