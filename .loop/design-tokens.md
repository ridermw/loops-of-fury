# Deck design tokens & voice — shared rubric anchor (D20)

**This file is the single source of truth for the deck's design system.** It is part
of the immutable control plane (D28): the maker may never edit it. The delight-judge
(D19) anchors its rubric to THESE tokens — not a generic notion of "delight" — so the
judge optimizes for *this* deck's actual language. The slop-guard (D18) and
visual-regression (D23) reference the same source.

The decks (`index.html`, `workshop.html`) are deliberately art-directed: a deep-navy
gradient stage, cool blues for structure, a single hot accent for emphasis, geometric
display type over a clean grotesque body. The aesthetic is **confident, technical,
restrained** — the opposite of generic SaaS-marketing slop.

## Palette (`:root`)

| Token | Hex | Role |
| --- | --- | --- |
| `--bg-top` | `#0a1b4d` | Stage gradient top (deep navy) |
| `--bg-bottom` | `#04102e` | Stage gradient bottom (near-black navy) |
| `--ink` | `#eef3ff` | Primary text (near-white, cool) |
| `--accent` | `#4d8cff` | Structural blue — links, lines, nodes |
| `--heading` | `#9cc2ff` | Headings (light steel blue) |
| `--fury` | `#ff6a4d` | THE single hot accent (orange-red) — used sparingly for emphasis |

**Invariant:** the system is navy + two cool blues + exactly one warm accent
(`--fury`). No rainbow, no off-palette colors, no second warm hue. `--fury` is a
scalpel, not a highlighter — overusing it is a slop signal.

## Type

| Token | Family | Usage |
| --- | --- | --- |
| `--font-display` | `'Space Grotesk'` | Headlines, big numbers, kickers — geometric, confident |
| `--font-body` | `'Inter'` | Body copy, captions, microcopy — clean, legible |

Hierarchy reads kicker → headline → body at a glance. Display type carries the
structure; body type carries the detail.

## Component vocabulary (real class names)

`kicker` (small uppercase label above a headline) · `big-number` (hero stat) ·
`card` (bordered content block) · `grid` / `three` (layout) · `pill` (small tag) ·
`subtitle` · `microcopy` (fine print) · `quote` + `source` (attributed pull-quote) ·
`flow` / `agent-loop` / nodes+`arrow` (the loop diagram) · `button-link`.

These already exist and are art-directed. The maker composes WITH them; inventing a
parallel set of ad-hoc styles is a drift signal.

## Voice & tone

- **Terse and declarative.** Short, confident sentences. No hedging ("might",
  "perhaps", "we believe").
- **Technical and concrete.** Names real tools, real mechanisms, real numbers. Earns
  authority with specifics, not adjectives.
- **Kicker → payoff.** A small label sets context; the headline lands a single idea.
- **Sourced.** Claims and quotes cite a real external link (the citation set the
  freshness axis guards).
- **Dry wit, not hype.** The deck's name is "Loops of Fury" — it has a sense of humor,
  but it never reaches for exclamation-point energy.

## Anti-slop blacklist (D18 — what the judge penalizes)

The judge flags NEW occurrences of generic AI/marketing slop. None of these belong in
this deck's voice:

1. Hype openers — "Unlock the power of", "Supercharge", "Revolutionize", "Elevate".
2. Empty intensifiers — "seamless", "robust", "cutting-edge", "next-level", "game-changer".
3. Emoji decoration used as bullet points or vibe (the deck uses none).
4. Exclamation-point energy / ALL-CAPS shouting (outside the deliberate display styling).
5. Hedging filler — "in today's fast-paced world", "it's important to note that".
6. Vague abstraction with no concrete referent — "solutions", "synergies", "leverage".
7. Rule-of-three padding — three empty adjectives where one concrete noun would do.
8. Off-palette color or a second warm accent competing with `--fury`.
9. Ad-hoc components/inline styles that bypass the established vocabulary above.
10. Headline that restates the kicker instead of advancing a new idea.

A legitimate edit deepens the thesis (loop-engineering: machine-checkable done-condition
→ narrow maker → independent checker → explicit loop contract) in this voice. The judge
rewards concrete, restrained, on-system writing and penalizes drift toward the list above.
