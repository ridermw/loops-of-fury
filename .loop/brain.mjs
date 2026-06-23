// .loop/brain.mjs — PURE loop-control decision logic. Control plane (D28).
//
// This module has NO side effects: no git, no fs, no network, no Date.now().
// Every time-dependent decision takes an explicit `now` so the whole brain is
// deterministic and exhaustively unit-testable (see tests/brain.test.mjs).
//
// The orchestrator (loop.mjs) owns the side effects (running the maker, the
// checker, git, escalation). It feeds each iteration outcome into `decide()`
// and obeys the returned decision. Keeping policy here, mechanism there, means
// the safety-critical rules (retry, churn cap, stop conditions, escalation)
// are provable in isolation.

// Map a raw iteration() outcome to a brain event category.
export function categorize(outcome) {
  switch (outcome && outcome.status) {
    case 'green':
      return outcome.committed ? 'green' : 'green-dry';
    case 'noop':
      return 'noop';
    case 'red':
    case 'gate-blocked':
    case 'live-broken': // post-push forward-revert (green-but-live-broken)
      return 'revert';
    case 'control-drift':
      return 'control-drift';
    case 'push-failed':
    case 'commit-failed':
      return 'ship-failed';
    default:
      return 'unknown';
  }
}

export function initState(opts = {}) {
  return {
    startMs: opts.startMs ?? 0,
    maxDurationMs: opts.maxDurationMs ?? 8 * 60 * 60 * 1000,
    maxNoops: opts.maxNoops ?? 5,
    retryK: opts.retryK ?? 3,
    churnWindowMs: opts.churnWindowMs ?? 30 * 60 * 1000,
    churnMax: opts.churnMax ?? 6,
    iter: 0,
    greenCount: 0,
    consecutiveNoops: 0,
    consecutiveFailures: 0,
    revertTimes: [],
    escalated: false,
    stop: null, // { reason } once the loop should terminate
  };
}

// Guard run BEFORE spending an expensive maker call: refuse to start a new
// iteration once the loop is stopped or the time cap is reached.
export function shouldStartIteration(state, now) {
  if (state.stop) return { start: false, reason: state.stop.reason };
  if (now - state.startMs >= state.maxDurationMs) return { start: false, reason: 'time-cap' };
  return { start: true };
}

// Pure transition. Returns { state: nextState, decision }.
// decision.action ∈ 'continue' | 'retry' | 'stop' | 'escalate-stop'.
// decision.switchAxis tells the orchestrator to pick a fresh axis next time.
export function decide(state, outcome, now) {
  const s = { ...state, revertTimes: [...state.revertTimes] };
  s.iter += 1;
  const cat = categorize(outcome);
  let decision;

  if (cat === 'green' || cat === 'green-dry') {
    s.consecutiveNoops = 0;
    s.consecutiveFailures = 0;
    if (cat === 'green') s.greenCount += 1;
    decision = { action: 'continue', switchAxis: true };
  } else if (cat === 'noop') {
    s.consecutiveNoops += 1;
    s.consecutiveFailures = 0;
    if (s.consecutiveNoops >= s.maxNoops) {
      decision = { action: 'stop', reason: 'no-progress' };
    } else {
      decision = { action: 'continue', switchAxis: true };
    }
  } else if (cat === 'control-drift') {
    // D28: any tamper of the control plane is critical — stop and escalate now.
    s.escalated = true;
    decision = { action: 'escalate-stop', reason: 'control-drift' };
  } else if (cat === 'ship-failed') {
    // Commit/push failed: an unattended loop must not spin uselessly — escalate.
    s.escalated = true;
    decision = { action: 'escalate-stop', reason: outcome.status };
  } else if (cat === 'revert') {
    s.consecutiveFailures += 1;
    s.revertTimes.push(now);
    s.revertTimes = s.revertTimes.filter((t) => now - t <= s.churnWindowMs);
    if (s.revertTimes.length > s.churnMax) {
      // D38: too much thrash → flakiness signal → pause + escalate.
      s.escalated = true;
      decision = { action: 'escalate-stop', reason: 'revert-churn' };
    } else if (s.consecutiveFailures >= s.retryK) {
      // K consecutive reverts on one line of attack → abandon this axis.
      s.consecutiveFailures = 0;
      decision = { action: 'continue', switchAxis: true, reason: 'retry-exhausted' };
    } else {
      decision = { action: 'retry' };
    }
  } else {
    s.escalated = true;
    decision = { action: 'escalate-stop', reason: `unknown:${outcome && outcome.status}` };
  }

  // Time cap supersedes any "keep going" decision (but never overrides an
  // escalation — a tamper/ship failure must still surface as escalated).
  if (decision.action === 'continue' || decision.action === 'retry') {
    if (now - s.startMs >= s.maxDurationMs) {
      decision = { action: 'stop', reason: 'time-cap' };
    }
  }

  if (decision.action === 'stop' || decision.action === 'escalate-stop') {
    s.stop = { reason: decision.reason };
  }
  return { state: s, decision };
}

// Weakest-axis selection (D10): lowest score wins; ties broken by round-robin
// (oldest lastPicked first). scoreboard: { axis: { score, lastPicked } }.
export function selectAxis(scoreboard) {
  const entries = Object.entries(scoreboard || {});
  if (entries.length === 0) return null;
  let best = null;
  for (const [axis, v] of entries) {
    const score = v?.score ?? 0;
    const lastPicked = v?.lastPicked ?? 0;
    if (
      best === null ||
      score < best.score ||
      (score === best.score && lastPicked < best.lastPicked)
    ) {
      best = { axis, score, lastPicked };
    }
  }
  return best.axis;
}
