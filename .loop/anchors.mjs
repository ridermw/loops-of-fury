// .loop/anchors.mjs — objective content-anchor floor (D32). Control plane (D28).
//
// A frozen, per-run holdout of each deck's structural + attribution anchors,
// captured BEFORE iteration 1 and never refreshed during the run. The checker
// asserts the floor every iteration; a violation is RED → revert.
//
// What the floor protects (objective, gating):
//   - HEADING COUNT never regresses — no section silently emptied or deleted.
//   - CITATION SET is a superset of baseline — attribution is sacred; the loop
//     may ADD sources but must never silently DROP one.
//
// What the floor deliberately does NOT gate (Premise 3 — delight is non-gating):
//   - heading WORDING. Improving copy is the loop's whole mandate; freezing
//     exact heading text would revert every legitimate reword and thrash main.
//     Lexical quality is judged by the non-gating delight/slop axes (D18/D35),
//     never here. `headingsLost` below is INFORMATIONAL only — it never sets ok.

// Collapse whitespace, trim. Empty → ''. Used for heading identity (count + info).
export function normHeading(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

// Lowercased heading key for the informational lost-heading diff (tolerant of
// case/spacing churn so the info signal tracks real disappearance, not restyle).
export function headingKey(s) {
  return normHeading(s).toLowerCase();
}

// Normalize a citation URL for set membership: trim, drop a single trailing
// slash, lowercase. Tolerant of trailing-slash/case churn while still treating
// genuinely different sources as distinct.
export function normCitation(u) {
  let s = String(u == null ? '' : u).trim();
  if (!s) return '';
  s = s.replace(/\/+$/, '');
  return s.toLowerCase();
}

function distinctNonEmpty(list, keyFn) {
  const set = new Set();
  for (const item of list || []) {
    const k = keyFn(item);
    if (k) set.add(k);
  }
  return set;
}

// Pure floor evaluation. baseline/current are { headings:string[], citations:string[] }.
// Returns the gating signals (headingCountDrop, missingCitations) plus an
// INFORMATIONAL headingsLost list. `ok` depends ONLY on the gating signals.
export function diffAnchors(baseline, current) {
  const base = baseline || { headings: [], citations: [] };
  const cur = current || { headings: [], citations: [] };

  const baseHeadKeys = distinctNonEmpty(base.headings, headingKey);
  const curHeadKeys = distinctNonEmpty(cur.headings, headingKey);
  const headingCountDrop = Math.max(0, baseHeadKeys.size - curHeadKeys.size);

  // Informational only: which distinct baseline headings are no longer present.
  const headingsLost = [];
  for (const h of base.headings || []) {
    const k = headingKey(h);
    if (k && !curHeadKeys.has(k) && !headingsLost.some((x) => headingKey(x) === k)) {
      headingsLost.push(normHeading(h));
    }
  }

  // Gating: every baseline citation must still be present (superset).
  const curCiteKeys = distinctNonEmpty(cur.citations, normCitation);
  const missingCitations = [];
  const seen = new Set();
  for (const c of base.citations || []) {
    const k = normCitation(c);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    if (!curCiteKeys.has(k)) missingCitations.push(String(c).trim());
  }

  return {
    ok: headingCountDrop === 0 && missingCitations.length === 0,
    baselineHeadingCount: baseHeadKeys.size,
    currentHeadingCount: curHeadKeys.size,
    headingCountDrop,
    missingCitations,
    headingsLost,
  };
}

// Render the gating violations as checker failure strings (D2 failure list).
// Only gating signals appear here; headingsLost is intentionally omitted.
export function anchorFailures(deckFile, baseline, current) {
  const d = diffAnchors(baseline, current);
  const out = [];
  if (d.headingCountDrop > 0) {
    out.push(
      `${deckFile}: heading count regressed ${d.baselineHeadingCount} -> ${d.currentHeadingCount}`,
    );
  }
  for (const url of d.missingCitations) {
    out.push(`${deckFile}: citation dropped — ${url}`);
  }
  return out;
}
