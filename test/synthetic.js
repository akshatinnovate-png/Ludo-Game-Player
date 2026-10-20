// Synthetic board photos for tests: a skewed, noisy picture of a board.
import { HOME_COLUMN, LOOP, SIZE, tokenPoint } from '../src/board.js';
import { applyH, imageToBoard } from '../src/vision.js';

const BOARD = { 0: [220, 40, 40], 1: [40, 160, 70], 2: [240, 200, 20], 3: [30, 110, 220] };
const TOKEN = { 0: [150, 20, 25], 1: [20, 100, 40], 2: [190, 140, 0], 3: [15, 60, 150] };
export const W = 800, Hh = 640;
export const CORNERS = [[150, 70], [660, 95], [700, 600], [110, 580]]; // slightly skewed photo

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function boardColour([y, x], state) {
  for (let c = 0; c < 4; c++) for (let i = 0; i < 4; i++) {
    const [ty, tx] = tokenPoint(c, state.pos[c][i], i);
    const d = Math.hypot(ty - y, tx - x);
    if (d < 0.26) return TOKEN[c];
    if (d < 0.33) return [245, 245, 245];
  }
  const r = Math.floor(y), col = Math.floor(x);
  if (y - r < 0.05 || x - col < 0.05) return [90, 90, 90];
  if (r < 6 && col < 6) return BOARD[0];
  if (r < 6 && col > 8) return BOARD[1];
  if (r > 8 && col > 8) return BOARD[2];
  if (r > 8 && col < 6) return BOARD[3];
  for (let k = 0; k < 4; k++) if (HOME_COLUMN[k].some(([py, px]) => Math.floor(py) === r && Math.floor(px) === col)) return BOARD[k];
  if (LOOP.some(([lr, lc]) => lr === r && lc === col)) return [250, 248, 240];
  return [200, 200, 200];
}

export function render(state, brightness = 1) {
  const H = imageToBoard(CORNERS);
  const data = new Uint8ClampedArray(W * Hh * 4);
  for (let py = 0; py < Hh; py++) for (let px = 0; px < W; px++) {
    const [x, y] = applyH(H, [px, py]);
    const rgb = x < 0 || y < 0 || x >= SIZE || y >= SIZE ? [60, 55, 50] : boardColour([y, x], state);
    const o = (py * W + px) * 4;
    for (let k = 0; k < 3; k++) data[o + k] = rgb[k] * brightness + (rand() - 0.5) * 24;
    data[o + 3] = 255;
  }
  return { width: W, height: Hh, data };
}

