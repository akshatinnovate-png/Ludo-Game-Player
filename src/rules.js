// Game rules. A token's progress `pos` is counted from its own start square:
//   -1        in the yard
//   0..50     on the shared loop (0 = start square)
//   51..55    in its home column
//   56        finished
// Rules implemented (house rules agreed with the players):
//   - a 6 brings a token out of the yard, and earns another throw
//   - three 6s in a row are void; the throw after them counts as a fresh start
//   - start and star squares are safe; landing elsewhere on opponents captures them
//   - a capture or getting a token home earns an extra throw
//   - exact throw needed to finish
//   - team play: the two colours of a team share their throws, so a throw by
//     either colour can move a token of either colour

import { SAFE_SQUARES, loopIndex } from './board.js';

export const YARD = -1;
export const LAST_LOOP = 50;
export const FINISH = 56;

export function newState() {
  return { pos: [0, 1, 2, 3].map(() => [YARD, YARD, YARD, YARD]) };
}

export const cloneState = s => ({ pos: s.pos.map(p => p.slice()) });

// Identical-looking positions get identical keys (tokens of a colour are interchangeable).
export const stateKey = s => s.pos.map(p => p.slice().sort((a, b) => a - b).join(',')).join('|');

export const teamCorners = (teams, team) => [0, 1, 2, 3].filter(c => teams[c] === team);

export function legalMoves(state, teams, team, die) {
  const moves = [];
  for (const c of teamCorners(teams, team)) {
    const seen = new Set();
    state.pos[c].forEach((p, i) => {
      if (seen.has(p)) return;
      let to = null;
      if (p === YARD) { if (die === 6) to = 0; }
      else if (p < FINISH && p + die <= FINISH) to = p + die;
      if (to === null) return;
      seen.add(p);
      moves.push({ corner: c, token: i, from: p, to, die });
    });
  }
  return moves;
}

export function applyMove(state, teams, move) {
  const next = cloneState(state);
  next.pos[move.corner][move.token] = move.to;
  const captured = [];
  if (move.to >= 0 && move.to <= LAST_LOOP) {
    const g = loopIndex(move.corner, move.to);
    if (!SAFE_SQUARES.has(g)) {
      for (let o = 0; o < 4; o++) {
        if (teams[o] === teams[move.corner]) continue;
        next.pos[o].forEach((q, j) => {
          if (q >= 0 && q <= LAST_LOOP && loopIndex(o, q) === g) {
            next.pos[o][j] = YARD;
            captured.push({ corner: o, token: j, from: q });
          }
        });
      }
    }
  }
  const finished = move.to === FINISH;
  return { state: next, captured, finished, bonus: captured.length + (finished ? 1 : 0) };
}

export const hasWon = (state, teams, team) =>
  teamCorners(teams, team).every(c => state.pos[c].every(p => p === FINISH));

// Turn the throws entered for one turn into the batch that is actually played.
// Throws are entered until a non-6 appears. Three 6s in a row are void and the
// player throws again, so everything up to and including them is dropped.
// Returns { dice, complete, voided }.
export function resolveThrows(throws) {
  let start = 0, run = 0, voided = 0;
  for (let i = 0; i < throws.length; i++) {
    if (throws[i] === 6) {
      run++;
      if (run === 3) { start = i + 1; run = 0; voided++; }
    } else {
      run = 0;
    }
  }
  const dice = throws.slice(start);
  const complete = dice.length > 0 && dice[dice.length - 1] !== 6;
  return { dice, complete, voided };
}

// Every distinct way to play a batch of dice (in any order, on any team token).
// A die with no legal move is forfeited. Returns plans with the resulting
// state, the move list, and the number of extra throws earned.
export function enumeratePlans(state, teams, team, dice) {
  const plans = new Map();
  const walk = (st, remaining, moves, bonus, captures) => {
    let moved = false;
    const tried = new Set();
    for (let k = 0; k < remaining.length; k++) {
      const d = remaining[k];
      if (tried.has(d)) continue;
      tried.add(d);
      const rest = remaining.slice(0, k).concat(remaining.slice(k + 1));
      for (const m of legalMoves(st, teams, team, d)) {
        moved = true;
        const r = applyMove(st, teams, m);
        walk(r.state, rest, [...moves, { ...m, captured: r.captured }], bonus + r.bonus, captures + r.captured.length);
      }
    }
    if (!moved) {
      const key = stateKey(st);
      const prev = plans.get(key);
      if (!prev || bonus > prev.bonus || (bonus === prev.bonus && moves.length > prev.moves.length)) {
        plans.set(key, { state: st, moves, bonus, captures, unused: remaining });
      }
    }
  };
  walk(state, dice, [], 0, 0);
  return [...plans.values()];
}
