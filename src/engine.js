// Move engine: expectiminimax over the dice, run entirely in the browser.
// It scores every way to play the throws, then looks ahead over the next
// seats' possible throws (chance nodes) and their best replies.

import { SAFE_SQUARES, loopIndex } from './board.js';
import { FINISH, LAST_LOOP, YARD, applyMove, enumeratePlans, hasWon, legalMoves, teamCorners } from './rules.js';

const WIN = 100000;
const EXTRA_THROW_VALUE = 9;

export function tokenValue(p) {
  if (p === YARD) return 0;
  if (p === FINISH) return 100;
  if (p > LAST_LOOP) return 72 + (p - 51) * 3; // home column: can no longer be captured
  return 16 + p;
}

// Chance that the token is captured before its team moves again, estimated
// from opponents within striking distance behind it.
export function hitChance(state, teams, corner, p) {
  if (p < 0 || p > LAST_LOOP) return 0;
  const g = loopIndex(corner, p);
  if (SAFE_SQUARES.has(g)) return 0;
  const near = new Set(), far = new Set();
  for (let o = 0; o < 4; o++) {
    if (teams[o] === teams[corner]) continue;
    for (const q of state.pos[o]) {
      if (q === YARD) {
        const d = (g - loopIndex(o, 0) + 52) % 52; // come out on a 6, then throw d
        if (d >= 1 && d <= 6) far.add(`${o}:${d + 6}`);
        continue;
      }
      if (q > LAST_LOOP) continue;
      const d = (g - loopIndex(o, q) + 52) % 52;
      if (d < 1 || d > 12 || q + d > LAST_LOOP) continue;
      if (d <= 6) near.add(d); else far.add(`${o}:${d}`);
    }
  }
  let miss = Math.pow(5 / 6, near.size) * Math.pow(35 / 36, far.size);
  return 1 - miss;
}

export function teamValue(state, teams, team) {
  let v = 0;
  for (const c of teamCorners(teams, team)) {
    for (const p of state.pos[c]) {
      const val = tokenValue(p);
      v += val - hitChance(state, teams, c, p) * val;
    }
  }
  return v;
}

export function evaluate(state, teams, team) {
  if (hasWon(state, teams, team)) return WIN;
  if (hasWon(state, teams, 1 - team)) return -WIN;
  return teamValue(state, teams, team) - teamValue(state, teams, 1 - team);
}

function expectation(state, teams, seat, depth, rootTeam) {
  if (depth === 0 || hasWon(state, teams, 0) || hasWon(state, teams, 1)) return evaluate(state, teams, rootTeam);
  const team = teams[seat];
  const next = (seat + 1) % 4;
  let total = 0;
  for (let d = 1; d <= 6; d++) {
    const moves = legalMoves(state, teams, team, d);
    if (!moves.length) { total += expectation(state, teams, next, depth - 1, rootTeam); continue; }
    let best = team === rootTeam ? -Infinity : Infinity;
    for (const m of moves) {
      const r = applyMove(state, teams, m);
      let v = expectation(r.state, teams, next, depth - 1, rootTeam);
      v += (team === rootTeam ? 1 : -1) * r.bonus * EXTRA_THROW_VALUE;
      best = team === rootTeam ? Math.max(best, v) : Math.min(best, v);
    }
    total += best;
  }
  return total / 6;
}

// Ranks every way the seat's team can play `dice`. Best first.
export function rankPlans(state, teams, seat, dice, { maxDepth = 3 } = {}) {
  const team = teams[seat];
  const plans = enumeratePlans(state, teams, team, dice);
  const depth = Math.min(maxDepth, plans.length <= 6 ? 3 : plans.length <= 80 ? 2 : plans.length <= 600 ? 1 : 0);
  const next = (seat + 1) % 4;
  for (const plan of plans) {
    plan.score = expectation(plan.state, teams, next, depth, team) + plan.bonus * EXTRA_THROW_VALUE;
  }
  plans.sort((a, b) => b.score - a.score);
  return { plans, depth };
}
