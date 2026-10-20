import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOOP, LOOP_LEN, HOME_COLUMN, TRACK_CELLS, posForCell, cellKey, rotate } from '../src/board.js';
import { newState, legalMoves, applyMove, resolveThrows, enumeratePlans, FINISH, YARD } from '../src/rules.js';
import { rankPlans } from '../src/engine.js';

// Corners 0 and 2 (top-left, bottom-right) are the AI team; 1 and 3 are the humans.
const TEAMS = [0, 1, 0, 1];
// Progress value that puts a token of `corner` on shared loop square `g`.
const at = (corner, g) => (g - corner * 13 + 52) % 52;

test('board geometry', () => {
  assert.equal(LOOP_LEN, 52);
  assert.equal(new Set(LOOP.map(c => c.join())).size, 52);
  assert.deepEqual(LOOP[13], [1, 8]);
  assert.deepEqual(LOOP[26], [8, 13]);
  assert.deepEqual(LOOP[39], [13, 6]);
  assert.deepEqual(rotate([6.5, 1.5]), [1.5, 8.5]);
  assert.deepEqual(HOME_COLUMN[1][0], [1.5, 7.5]);
  assert.equal(TRACK_CELLS.length, 72);
  for (let c = 0; c < 4; c++) for (let p = 0; p <= 55; p++) assert.equal(posForCell(c, cellKey(c, p)), p);
});

test('three sixes are void and the next throw starts fresh', () => {
  assert.deepEqual(resolveThrows([6, 4]), { dice: [6, 4], complete: true, voided: 0 });
  assert.deepEqual(resolveThrows([6, 6]), { dice: [6, 6], complete: false, voided: 0 });
  assert.deepEqual(resolveThrows([6, 6, 6]), { dice: [], complete: false, voided: 1 });
  assert.deepEqual(resolveThrows([6, 6, 6, 2]), { dice: [2], complete: true, voided: 1 });
  assert.deepEqual(resolveThrows([6, 6, 6, 6, 3]), { dice: [6, 3], complete: true, voided: 1 });
});

test('a six is needed to leave the yard, and team throws move either colour', () => {
  const s = newState();
  assert.equal(legalMoves(s, TEAMS, 0, 4).length, 0);
  const moves = legalMoves(s, TEAMS, 0, 6);
  assert.deepEqual(moves.map(m => m.corner), [0, 2]);
});

test('capture sends opponents home except on safe squares', () => {
  const s = newState();
  s.pos[0][0] = 3;
  s.pos[1][0] = at(1, 5); // corner 1 token on loop square 5
  const r = applyMove(s, TEAMS, { corner: 0, token: 0, from: 3, to: 5, die: 2 });
  assert.equal(r.captured.length, 1);
  assert.equal(r.state.pos[1][0], YARD);
  assert.equal(r.bonus, 1);

  const t = newState();
  t.pos[0][0] = 3;
  t.pos[1][0] = at(1, 8); // on the star at loop square 8
  assert.equal(applyMove(t, TEAMS, { corner: 0, token: 0, from: 3, to: 8, die: 5 }).captured.length, 0);
});

test('teammates are never captured', () => {
  const s = newState();
  s.pos[0][0] = 3;
  s.pos[2][0] = at(2, 5);
  assert.equal(applyMove(s, TEAMS, { corner: 0, token: 0, from: 3, to: 5, die: 2 }).captured.length, 0);
});

test('exact throw needed to finish', () => {
  const s = newState();
  s.pos[0][0] = 54;
  const moves = legalMoves(s, TEAMS, 0, 3);
  assert.equal(moves.length, 0);
  assert.equal(legalMoves(s, TEAMS, 0, 2)[0].to, FINISH);
});

test('plans cover dice orders and dedupe identical results', () => {
  const s = newState();
  const plans = enumeratePlans(s, TEAMS, 0, [6, 4]);
  // Come out with the 6 then move 4 (either colour), and nothing else.
  assert.equal(plans.length, 2);
  for (const p of plans) assert.equal(p.moves.length, 2);
});

test('engine prefers a capture over a quiet move', () => {
  const s = newState();
  s.pos[0][0] = 10;
  s.pos[0][1] = 30;
  s.pos[1][0] = at(1, 14); // corner 1 token on loop square 14, 4 ahead of ours
  const { plans } = rankPlans(s, TEAMS, 0, [4]);
  assert.equal(plans[0].moves[0].from, 10);
  assert.equal(plans[0].captures, 1);
});

test('engine moves a threatened token to safety', () => {
  const s = newState();
  s.pos[0][0] = 20;            // loop square 20, threatened from behind
  s.pos[0][1] = 2;             // safe-ish quiet token
  s.pos[1][0] = at(1, 17);  // corner 1 token on loop 17, 3 behind ours
  const { plans } = rankPlans(s, TEAMS, 0, [1]);
  assert.equal(plans[0].moves[0].from, 20); // 20 -> 21 is a star
});

test('engine search is fast enough for a phone', () => {
  const s = newState();
  s.pos[0] = [5, 12, 30, YARD];
  s.pos[2] = [3, 40, YARD, YARD];
  s.pos[1] = [8, 20, 33, YARD];
  s.pos[3] = [1, 15, YARD, YARD];
  const t = Date.now();
  rankPlans(s, TEAMS, 0, [6, 6, 3]);
  rankPlans(s, TEAMS, 0, [5]);
  assert.ok(Date.now() - t < 3000, `took ${Date.now() - t}ms`);
});
