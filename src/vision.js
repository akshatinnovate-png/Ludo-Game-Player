// On-device board reading. No network, no model download.
//
// 1. Calibration (once per game, with every token in its yard): the player
//    taps the four board corners and one token of each colour. We remember
//    what every empty track square looks like and what each token colour is.
// 2. Each later photo: map the board with the same corners (or new ones),
//    and for every track square measure how many pixels changed from the
//    empty-board reference and which token colour they look like.
// 3. Rather than trusting that reading blindly, compare it with every board
//    that could legally follow the last saved board and the dice entered, and
//    pick the best match. A free reading is only used as a last resort.

import { SIZE, TRACK_CELLS, cellKey, posForCell } from './board.js';
import { FINISH, YARD, cloneState } from './rules.js';

const GRID = 6;            // samples per side inside each cell
const CHANGE_T = 42;       // RGB distance that counts as "different from empty"
const COLOR_T = 95;        // max RGB distance to a token colour

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

// 3x3 homography (row-major, h33 = 1) taking src[i] -> dst[i], points as [x, y].
export function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  return [...solve(A, b), 1];
}

export function applyH(H, [x, y]) {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

// corners: image points [x, y] for the board's top-left, top-right,
// bottom-right, bottom-left (as the board's top-left yard is oriented).
export const boardToImage = corners =>
  homography([[0, 0], [SIZE, 0], [SIZE, SIZE], [0, SIZE]], corners);
export const imageToBoard = corners =>
  homography(corners, [[0, 0], [SIZE, 0], [SIZE, SIZE], [0, SIZE]]);

// Board point ([y, x] in cells) -> image pixel [x, y].
export const projectPoint = (H, [y, x]) => applyH(H, [x, y]);

function pixel(img, x, y) {
  const xi = Math.round(x), yi = Math.round(y);
  let r = 0, g = 0, b = 0, n = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const px = Math.min(img.width - 1, Math.max(0, xi + dx));
    const py = Math.min(img.height - 1, Math.max(0, yi + dy));
    const o = (py * img.width + px) * 4;
    r += img.data[o]; g += img.data[o + 1]; b += img.data[o + 2]; n++;
  }
  return [r / n, g / n, b / n];
}

function sampleCell(img, H, [cy, cx]) {
  const out = [];
  for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) {
    const y = cy - 0.32 + (0.64 * (i + 0.5)) / GRID;
    const x = cx - 0.32 + (0.64 * (j + 0.5)) / GRID;
    out.push(pixel(img, ...projectPoint(H, [y, x])));
  }
  return out;
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const lum = p => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];

function sampleAll(img, corners) {
  const H = boardToImage(corners);
  const cells = {};
  for (const { key, point } of TRACK_CELLS) cells[key] = sampleCell(img, H, point);
  return cells;
}

function meanLum(cells) {
  let s = 0, n = 0;
  for (const px of Object.values(cells)) for (const p of px) { s += lum(p); n++; }
  return s / n;
}

// Average colour in a small disc around an image point (a tapped token).
export function sampleDisc(img, [x, y], radius) {
  let acc = [0, 0, 0], n = 0;
  const r = Math.max(2, Math.round(radius));
  for (let dy = -r; dy <= r; dy += 2) for (let dx = -r; dx <= r; dx += 2) {
    if (dx * dx + dy * dy > r * r) continue;
    const p = pixel(img, x + dx, y + dy);
    acc = acc.map((v, i) => v + p[i]); n++;
  }
  return acc.map(v => v / n);
}

export const cellSizePx = corners =>
  (dist([...corners[0], 0], [...corners[1], 0]) + dist([...corners[3], 0], [...corners[2], 0])) / 2 / SIZE;

// tokenTaps: one image point per corner colour (index = corner).
export function calibrate(img, corners, tokenTaps) {
  const reference = sampleAll(img, corners);
  const radius = cellSizePx(corners) * 0.22;
  const tokenColors = tokenTaps.map(p => sampleDisc(img, p, radius));
  return { corners, tokenColors, reference, refLum: meanLum(reference) };
}

// Per track cell: how much changed from the empty board, and how strongly
// each of the four token colours is present.
export function analyze(img, calib, corners = calib.corners) {
  const cells = sampleAll(img, corners);
  const gain = calib.refLum / Math.max(1, meanLum(cells));
  const out = {};
  for (const { key } of TRACK_CELLS) {
    const ref = calib.reference[key];
    let changed = 0;
    const color = [0, 0, 0, 0];
    cells[key].forEach((raw, j) => {
      const p = raw.map(v => Math.min(255, v * gain));
      if (dist(p, ref[j]) < CHANGE_T) return;
      changed++;
      let best = -1, bd = Infinity;
      calib.tokenColors.forEach((tc, k) => { const d = dist(p, tc); if (d < bd) { bd = d; best = k; } });
      if (bd < COLOR_T) color[best]++;
    });
    const n = cells[key].length;
    out[key] = { change: changed / n, color: color.map(c => c / n) };
  }
  return out;
}

function occupancy(state) {
  const occ = {};
  state.pos.forEach((ps, c) => ps.forEach(p => {
    const key = cellKey(c, p);
    if (!key) return;
    (occ[key] ||= new Set()).add(c);
  }));
  return occ;
}

// How well a board state explains the photo. Higher is better.
export function scoreState(analysis, state) {
  const occ = occupancy(state);
  let score = 0;
  for (const [key, cell] of Object.entries(analysis)) {
    const here = occ[key];
    for (let c = 0; c < 4; c++) {
      const s = cell.color[c];
      score += here && here.has(c) ? s * 2 - 0.08 : -s * 2;
    }
    score += here ? cell.change - 0.15 : -cell.change;
  }
  return score;
}

// Rank candidate plans (from enumeratePlans) by how well they match the photo.
export function matchPlans(analysis, plans) {
  return plans
    .map(plan => ({ plan, match: scoreState(analysis, plan.state) }))
    .sort((a, b) => b.match - a.match);
}

// Read the board straight from the photo, keeping finished tokens from the
// previous state (the centre is not inspected). Used when nothing legal fits.
export function detectState(analysis, prev) {
  const next = cloneState(prev);
  const found = [];
  for (const [key, cell] of Object.entries(analysis)) {
    cell.color.forEach((s, c) => {
      if (s >= 0.12 && posForCell(c, key) !== null) found.push({ c, key, s });
    });
  }
  found.sort((a, b) => b.s - a.s);
  for (let c = 0; c < 4; c++) {
    const finished = prev.pos[c].filter(p => p === FINISH).length;
    const spots = found.filter(f => f.c === c).slice(0, 4 - finished).map(f => posForCell(c, f.key));
    const pos = [...Array(finished).fill(FINISH), ...spots];
    while (pos.length < 4) pos.push(YARD);
    next.pos[c] = pos;
  }
  return next;
}
