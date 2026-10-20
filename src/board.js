// Board geometry for a standard 15x15 Ludo board.
//
// Coordinates are continuous (y, x) in cell units: cell (row r, col c) has its
// centre at (r + 0.5, c + 0.5) and the whole board spans [0, 15] x [0, 15].
// Corners are numbered clockwise: 0 = top-left, 1 = top-right,
// 2 = bottom-right, 3 = bottom-left. Play moves clockwise, so turn order is
// 0 -> 1 -> 2 -> 3.

export const SIZE = 15;
export const CORNER_NAMES = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];

// Rotate a continuous point a quarter turn clockwise around the board centre.
export function rotate([y, x], times = 1) {
  let p = [y, x];
  for (let i = 0; i < ((times % 4) + 4) % 4; i++) p = [p[1], SIZE - p[0]];
  return p;
}

const cellCentre = (r, c) => [r + 0.5, c + 0.5];

// The shared 52-square loop. Index 0 is the start square of the top-left
// colour; each next colour starts 13 squares further on.
function buildLoop() {
  const cells = [];
  for (let c = 1; c <= 5; c++) cells.push([6, c]);
  for (let r = 5; r >= 0; r--) cells.push([r, 6]);
  cells.push([0, 7]);
  for (let r = 0; r <= 5; r++) cells.push([r, 8]);
  for (let c = 9; c <= 14; c++) cells.push([6, c]);
  cells.push([7, 14]);
  for (let c = 14; c >= 9; c--) cells.push([8, c]);
  for (let r = 9; r <= 14; r++) cells.push([r, 8]);
  cells.push([14, 7]);
  for (let r = 14; r >= 9; r--) cells.push([r, 6]);
  for (let c = 5; c >= 0; c--) cells.push([8, c]);
  cells.push([7, 0]);
  cells.push([6, 0]);
  return cells;
}

export const LOOP = buildLoop(); // [row, col] for each of the 52 squares
export const LOOP_LEN = LOOP.length;

// Start squares and star squares cannot be captured on.
export const START_SQUARES = [0, 13, 26, 39];
export const SAFE_SQUARES = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

// Home column (5 squares) for each corner, outermost first.
export const HOME_COLUMN = [0, 1, 2, 3].map(k =>
  [1, 2, 3, 4, 5].map(c => rotate(cellCentre(7, c), k)),
);

// Where the four tokens sit in a corner's yard, and where finished tokens go.
const YARD_TL = [[1.9, 1.9], [1.9, 4.1], [4.1, 1.9], [4.1, 4.1]];
export const YARD_SPOTS = [0, 1, 2, 3].map(k => YARD_TL.map(p => rotate(p, k)));
const FINISH_TL = [[7.1, 6.55], [7.9, 6.55], [6.75, 6.3], [8.25, 6.3]];
export const FINISH_SPOTS = [0, 1, 2, 3].map(k => FINISH_TL.map(p => rotate(p, k)));

export const loopIndex = (corner, pos) => (corner * 13 + pos) % LOOP_LEN;

// Board point for a token of `corner` at progress `pos` (see rules.js).
export function tokenPoint(corner, pos, tokenIndex = 0) {
  if (pos < 0) return YARD_SPOTS[corner][tokenIndex];
  if (pos >= 56) return FINISH_SPOTS[corner][tokenIndex];
  if (pos >= 51) return HOME_COLUMN[corner][pos - 51];
  const [r, c] = LOOP[loopIndex(corner, pos)];
  return cellCentre(r, c);
}

// Cell key used to compare token positions with what the camera sees.
// Yard and finished tokens have no cell (they are off the track).
export function cellKey(corner, pos) {
  if (pos < 0 || pos >= 56) return null;
  if (pos >= 51) return `H${corner}_${pos - 51}`;
  return `L${loopIndex(corner, pos)}`;
}

// Every track cell the camera inspects, with its centre point.
export const TRACK_CELLS = [
  ...LOOP.map(([r, c], g) => ({ key: `L${g}`, point: cellCentre(r, c) })),
  ...HOME_COLUMN.flatMap((col, k) => col.map((point, j) => ({ key: `H${k}_${j}`, point }))),
];

// Which progress value a cell means for a token of `corner`, or null if that
// token can never stand there.
export function posForCell(corner, key) {
  if (key.startsWith('L')) {
    const g = Number(key.slice(1));
    const pos = (g - corner * 13 + LOOP_LEN) % LOOP_LEN;
    return pos <= 50 ? pos : null;
  }
  const [k, j] = key.slice(1).split('_').map(Number);
  return k === corner ? 51 + j : null;
}

// Map a continuous board point to the cell key under it, or a zone name.
export function zoneAt([y, x]) {
  if (y < 0 || x < 0 || y >= SIZE || x >= SIZE) return null;
  const r = Math.floor(y), c = Math.floor(x);
  if (r < 6 && c < 6) return { yard: 0 };
  if (r < 6 && c > 8) return { yard: 1 };
  if (r > 8 && c > 8) return { yard: 2 };
  if (r > 8 && c < 6) return { yard: 3 };
  if (r >= 6 && r <= 8 && c >= 6 && c <= 8) return { finish: true };
  const g = LOOP.findIndex(([lr, lc]) => lr === r && lc === c);
  if (g >= 0) return { key: `L${g}` };
  for (let k = 0; k < 4; k++) {
    const j = HOME_COLUMN[k].findIndex(([py, px]) => Math.floor(py) === r && Math.floor(px) === c);
    if (j >= 0) return { key: `H${k}_${j}` };
  }
  return null;
}
