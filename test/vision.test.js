import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenPoint } from '../src/board.js';
import { boardToImage, calibrate, analyze, matchPlans, projectPoint, detectState } from '../src/vision.js';
import { CORNERS, render } from './synthetic.js';
import { newState, enumeratePlans, stateKey } from '../src/rules.js';

const TEAMS = [0, 1, 0, 1];

test('photo reading picks the move that was actually played', () => {
  const start = newState();
  const Hb = boardToImage(CORNERS);
  const taps = [0, 1, 2, 3].map(c => projectPoint(Hb, tokenPoint(c, -1, 0)));
  const calib = calibrate(render(start), CORNERS, taps);

  // Mid-game position.
  const s = newState();
  s.pos[0] = [5, 20, -1, -1];
  s.pos[1] = [3, 30, -1, -1];
  s.pos[2] = [10, -1, -1, -1];
  s.pos[3] = [24, -1, -1, -1];
  const plans = enumeratePlans(s, TEAMS, 0, [4]);
  assert.ok(plans.length >= 3);

  for (const truth of plans) {
    const photo = render(truth.state, 0.85); // dimmer light than at calibration
    const ranked = matchPlans(analyze(photo, calib), plans);
    assert.equal(stateKey(ranked[0].plan.state), stateKey(truth.state), `expected ${JSON.stringify(truth.moves)}`);
  }
});

test('free reading finds tokens without a previous board', () => {
  const start = newState();
  const Hb = boardToImage(CORNERS);
  const taps = [0, 1, 2, 3].map(c => projectPoint(Hb, tokenPoint(c, -1, 0)));
  const calib = calibrate(render(start), CORNERS, taps);
  const s = newState();
  s.pos[0] = [5, 20, -1, -1];
  s.pos[1] = [3, -1, -1, -1];
  s.pos[3] = [53, -1, -1, -1];
  const seen = detectState(analyze(render(s), calib), newState());
  assert.equal(stateKey(seen), stateKey(s));
});
