// Drawing: the virtual board, and annotations on top of a board photo.

import { HOME_COLUMN, LOOP, SAFE_SQUARES, SIZE, START_SQUARES, tokenPoint } from './board.js';
import { projectPoint } from './vision.js';

export const PALETTE = {
  red: { fill: '#e53935', soft: '#ffcdd2', ink: '#fff' },
  green: { fill: '#2e9e44', soft: '#c8e6c9', ink: '#fff' },
  yellow: { fill: '#f9c80e', soft: '#fff3b0', ink: '#3a3000' },
  blue: { fill: '#1e7be5', soft: '#bbdefb', ink: '#fff' },
};

// Spread tokens that share a square so each stays visible and tappable.
export function tokenLayout(state) {
  const groups = new Map();
  state.pos.forEach((ps, c) => ps.forEach((p, i) => {
    const pt = tokenPoint(c, p, i);
    const key = p < 0 || p >= 56 ? `${c}:${p}:${i}` : pt.join();
    if (!groups.has(key)) groups.set(key, { pt, tokens: [] });
    groups.get(key).tokens.push({ corner: c, token: i, pos: p });
  }));
  const out = [];
  for (const { pt, tokens } of groups.values()) {
    tokens.forEach((t, k) => {
      const n = tokens.length;
      const off = n === 1 ? [0, 0] : [Math.sin((k / n) * 2 * Math.PI) * 0.2, Math.cos((k / n) * 2 * Math.PI) * 0.2];
      out.push({ ...t, point: [pt[0] + off[0], pt[1] + off[1]], stacked: n });
    });
  }
  return out;
}

function star(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}

function drawToken(ctx, [x, y], r, colour, { selected = false, ghost = false, label = '' } = {}) {
  const pal = PALETTE[colour];
  ctx.save();
  ctx.globalAlpha = ghost ? 0.45 : 1;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = pal.fill;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, r * 0.22);
  ctx.strokeStyle = selected ? '#000' : '#fff';
  ctx.stroke();
  if (label) {
    ctx.fillStyle = pal.ink;
    ctx.font = `bold ${Math.round(r * 1.1)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y + r * 0.05);
  }
  ctx.restore();
}

// Path of board points a move travels through, for drawing the arrow.
export function movePath(move) {
  const pts = [];
  if (move.from < 0) return [tokenPoint(move.corner, -1, move.token), tokenPoint(move.corner, 0)];
  for (let p = move.from; p <= move.to; p++) pts.push(tokenPoint(move.corner, p, 0));
  return pts;
}

function drawArrow(ctx, pts, colour, width, label) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [w, stroke] of [[width + 4, 'rgba(0,0,0,0.75)'], [width, colour]]) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](x, y));
    ctx.strokeStyle = stroke;
    ctx.lineWidth = w;
    ctx.stroke();
  }
  const [x2, y2] = pts[pts.length - 1];
  const [x1, y1] = pts[pts.length - 2];
  const a = Math.atan2(y2 - y1, x2 - x1);
  const h = width * 3.2;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - h * Math.cos(a - 0.5), y2 - h * Math.sin(a - 0.5));
  ctx.lineTo(x2 - h * Math.cos(a + 0.5), y2 - h * Math.sin(a + 0.5));
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();
  if (label) {
    const [lx, ly] = pts[0];
    ctx.beginPath();
    ctx.arc(lx, ly, width * 2.2, 0, Math.PI * 2);
    ctx.fillStyle = '#111';
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(width * 2.6)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, lx, ly + 1);
  }
  ctx.restore();
}

// colours: colour name per corner. opts.moves: suggested moves to draw as arrows.
export function drawBoard(canvas, state, colours, opts = {}) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, s = W / SIZE;
  const px = ([y, x]) => [x * s, y * s];
  ctx.clearRect(0, 0, W, W);
  ctx.fillStyle = '#fbfaf7';
  ctx.fillRect(0, 0, W, W);

  // Yards
  const yardOrigin = [[0, 0], [0, 9], [9, 9], [9, 0]];
  yardOrigin.forEach(([r, c], k) => {
    ctx.fillStyle = PALETTE[colours[k]].fill;
    ctx.fillRect(c * s, r * s, 6 * s, 6 * s);
    ctx.fillStyle = '#fff';
    ctx.fillRect((c + 0.8) * s, (r + 0.8) * s, 4.4 * s, 4.4 * s);
  });

  const cell = (r, c, fill) => {
    ctx.fillStyle = fill;
    ctx.fillRect(c * s, r * s, s, s);
    ctx.strokeStyle = '#c9c4b8';
    ctx.lineWidth = 1;
    ctx.strokeRect(c * s + 0.5, r * s + 0.5, s - 1, s - 1);
  };
  LOOP.forEach(([r, c], g) => {
    const startOf = START_SQUARES.indexOf(g);
    cell(r, c, startOf >= 0 ? PALETTE[colours[startOf]].fill : '#fff');
    if (SAFE_SQUARES.has(g) && startOf < 0) {
      star(ctx, (c + 0.5) * s, (r + 0.5) * s, s * 0.32);
      ctx.fillStyle = '#d6d0c2';
      ctx.fill();
    }
  });
  HOME_COLUMN.forEach((col, k) => col.forEach(([y, x]) => cell(Math.floor(y), Math.floor(x), PALETTE[colours[k]].fill)));

  // Centre triangles
  const tri = [[[6, 6], [9, 6], [7.5, 7.5]], [[6, 6], [6, 9], [7.5, 7.5]], [[6, 9], [9, 9], [7.5, 7.5]], [[9, 6], [9, 9], [7.5, 7.5]]];
  tri.forEach((t, k) => {
    ctx.beginPath();
    t.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](...px(p)));
    ctx.closePath();
    ctx.fillStyle = PALETTE[colours[k]].fill;
    ctx.fill();
  });

  const moving = new Set((opts.moves || []).map(m => `${m.corner}:${m.token}`));
  for (const t of tokenLayout(state)) {
    drawToken(ctx, px(t.point), s * 0.34, colours[t.corner], {
      selected: opts.selected && opts.selected.corner === t.corner && opts.selected.token === t.token,
      ghost: opts.ghostMoving && moving.has(`${t.corner}:${t.token}`),
    });
  }
  (opts.moves || []).forEach((m, i) =>
    drawArrow(ctx, movePath(m).map(px), PALETTE[colours[m.corner]].fill, Math.max(3, s * 0.16), opts.moves.length > 1 ? String(i + 1) : ''));
}

// Draw the photo with the mapped grid, read tokens and suggested moves.
export function drawPhoto(canvas, image, opts = {}) {
  const ctx = canvas.getContext('2d');
  canvas.width = image.width;
  canvas.height = image.height;
  ctx.drawImage(image, 0, 0);
  const { H, colours, state, moves = [], cornerTaps = [], showGrid = true } = opts;
  const unit = Math.max(canvas.width, canvas.height) / 300;

  if (H && showGrid) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = Math.max(1, unit * 0.5);
    for (let i = 0; i <= SIZE; i++) {
      for (const seg of [[[i, 0], [i, SIZE]], [[0, i], [SIZE, i]]]) {
        ctx.beginPath();
        ctx.moveTo(...projectPoint(H, seg[0]));
        ctx.lineTo(...projectPoint(H, seg[1]));
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  if (H && state) {
    const s0 = projectPoint(H, [0, 0]), s1 = projectPoint(H, [0, 1]);
    const cellPx = Math.hypot(s1[0] - s0[0], s1[1] - s0[1]);
    for (const t of tokenLayout(state)) {
      if (t.pos < 0) continue;
      const [x, y] = projectPoint(H, t.point);
      ctx.beginPath();
      ctx.arc(x, y, cellPx * 0.42, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(2, unit);
      ctx.strokeStyle = PALETTE[colours[t.corner]].fill;
      ctx.stroke();
    }
    moves.forEach((m, i) =>
      drawArrow(ctx, movePath(m).map(p => projectPoint(H, p)), PALETTE[colours[m.corner]].fill, Math.max(4, cellPx * 0.18), moves.length > 1 ? String(i + 1) : ''));
  }
  cornerTaps.forEach(([x, y], i) => {
    ctx.beginPath();
    ctx.arc(x, y, unit * 4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,0,170,0.85)';
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(unit * 5)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), x, y);
  });
}
