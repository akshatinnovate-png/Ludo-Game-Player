// Board graphics: a static board drawn once per resize, with pawns, highlights
// and move animations drawn on top every frame.

import { HOME_COLUMN, LOOP, SAFE_SQUARES, SIZE, START_SQUARES, YARD_SPOTS, loopIndex, tokenPoint } from './board.js';

export const PALETTE = {
  red: { base: '#e53935', light: '#ff7a6b', dark: '#a91d1d', tint: '#ffe3de', ink: '#fff' },
  green: { base: '#2fa84f', light: '#6bd889', dark: '#18742f', tint: '#ddf5e3', ink: '#fff' },
  yellow: { base: '#f5bd12', light: '#ffe06b', dark: '#b88600', tint: '#fff4c9', ink: '#3b2d00' },
  blue: { base: '#1e7be5', light: '#62acff', dark: '#0d4f9e', tint: '#dbeaff', ink: '#fff' },
};

const STEP_MS = 140;

// Spread tokens that share a square so each stays visible and clickable.
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
    const n = tokens.length;
    tokens.forEach((t, k) => {
      const off = n === 1 ? [0, 0] : [Math.sin((k / n) * 2 * Math.PI) * 0.18, Math.cos((k / n) * 2 * Math.PI) * 0.18];
      out.push({ ...t, point: [pt[0] + off[0], pt[1] + off[1]], scale: n === 1 ? 1 : 0.8 });
    });
  }
  return out;
}

// Board points a move passes through, start to end.
export function movePath(move) {
  if (move.from < 0) return [tokenPoint(move.corner, -1, move.token), tokenPoint(move.corner, 0)];
  const pts = [];
  for (let p = move.from; p <= move.to; p++) pts.push(tokenPoint(move.corner, p, move.token));
  return pts;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function starPath(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}

function arrow(ctx, x, y, angle, size, colour) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(size * 0.55, 0);
  ctx.lineTo(-size * 0.25, -size * 0.42);
  ctx.lineTo(-size * 0.05, 0);
  ctx.lineTo(-size * 0.25, size * 0.42);
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.restore();
}

function drawStaticBoard(ctx, W, colours) {
  const s = W / SIZE;
  const P = k => PALETTE[colours[k]];
  ctx.clearRect(0, 0, W, W);

  // Base
  const base = ctx.createLinearGradient(0, 0, W, W);
  base.addColorStop(0, '#fffdf8');
  base.addColorStop(1, '#f1ebdf');
  roundRect(ctx, 0, 0, W, W, s * 0.5);
  ctx.fillStyle = base;
  ctx.fill();

  // Yards
  [[0, 0], [0, 9], [9, 9], [9, 0]].forEach(([r, c], k) => {
    const x = c * s, y = r * s, pal = P(k);
    const g = ctx.createLinearGradient(x, y, x + 6 * s, y + 6 * s);
    g.addColorStop(0, pal.light);
    g.addColorStop(0.55, pal.base);
    g.addColorStop(1, pal.dark);
    roundRect(ctx, x + s * 0.12, y + s * 0.12, 6 * s - s * 0.24, 6 * s - s * 0.24, s * 0.6);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = s * 0.35;
    ctx.shadowOffsetY = s * 0.06;
    roundRect(ctx, x + s * 0.95, y + s * 0.95, 4.1 * s, 4.1 * s, s * 0.45);
    ctx.fillStyle = '#fffdf8';
    ctx.fill();
    ctx.restore();
    for (const [py, px] of YARD_SPOTS[k]) {
      const cx = px * s, cy = py * s;
      const ng = ctx.createRadialGradient(cx, cy - s * 0.15, s * 0.1, cx, cy, s * 0.62);
      ng.addColorStop(0, pal.tint);
      ng.addColorStop(1, pal.light);
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.6, 0, Math.PI * 2);
      ctx.fillStyle = ng;
      ctx.fill();
      ctx.lineWidth = s * 0.06;
      ctx.strokeStyle = pal.base;
      ctx.stroke();
    }
  });

  // Track squares
  const square = (r, c, fill) => {
    roundRect(ctx, c * s + s * 0.04, r * s + s * 0.04, s * 0.92, s * 0.92, s * 0.14);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = Math.max(1, s * 0.03);
    ctx.strokeStyle = 'rgba(80,60,30,0.14)';
    ctx.stroke();
  };
  LOOP.forEach(([r, c], g) => {
    const owner = START_SQUARES.indexOf(g);
    if (owner >= 0) {
      const pal = P(owner);
      const gr = ctx.createLinearGradient(c * s, r * s, (c + 1) * s, (r + 1) * s);
      gr.addColorStop(0, pal.light);
      gr.addColorStop(1, pal.base);
      square(r, c, gr);
      const [nr, nc] = LOOP[(g + 1) % LOOP.length];
      arrow(ctx, (c + 0.5) * s, (r + 0.5) * s, Math.atan2(nr - r, nc - c), s * 0.62, 'rgba(255,255,255,0.95)');
    } else {
      square(r, c, '#ffffff');
      if (SAFE_SQUARES.has(g)) {
        starPath(ctx, (c + 0.5) * s, (r + 0.5) * s, s * 0.34);
        ctx.fillStyle = '#f3e3b0';
        ctx.fill();
        ctx.lineWidth = s * 0.05;
        ctx.strokeStyle = '#d4a93a';
        ctx.stroke();
      }
    }
  });
  // Entry arrows on the square before each home column
  for (let k = 0; k < 4; k++) {
    const [r, c] = LOOP[loopIndex(k, 50)];
    const [hy, hx] = HOME_COLUMN[k][0];
    arrow(ctx, (c + 0.5) * s, (r + 0.5) * s, Math.atan2(hy - (r + 0.5), hx - (c + 0.5)), s * 0.5, P(k).base);
  }
  HOME_COLUMN.forEach((col, k) => col.forEach(([y, x], j) => {
    const pal = P(k);
    const gr = ctx.createLinearGradient((x - 0.5) * s, (y - 0.5) * s, (x + 0.5) * s, (y + 0.5) * s);
    gr.addColorStop(0, j % 2 ? pal.base : pal.light);
    gr.addColorStop(1, pal.dark);
    square(Math.floor(y), Math.floor(x), gr);
  }));

  // Centre
  const tri = [[[6, 6], [9, 6]], [[6, 6], [6, 9]], [[6, 9], [9, 9]], [[9, 6], [9, 9]]];
  tri.forEach(([a, b], k) => {
    const pal = P(k);
    const g = ctx.createLinearGradient(((a[1] + b[1]) / 2) * s, ((a[0] + b[0]) / 2) * s, 7.5 * s, 7.5 * s);
    g.addColorStop(0, pal.base);
    g.addColorStop(1, pal.light);
    ctx.beginPath();
    ctx.moveTo(a[1] * s, a[0] * s);
    ctx.lineTo(b[1] * s, b[0] * s);
    ctx.lineTo(7.5 * s, 7.5 * s);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = s * 0.05;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.stroke();
  });
  ctx.beginPath();
  ctx.arc(7.5 * s, 7.5 * s, s * 0.55, 0, Math.PI * 2);
  ctx.fillStyle = '#fffdf8';
  ctx.fill();
  starPath(ctx, 7.5 * s, 7.5 * s, s * 0.38);
  ctx.fillStyle = '#e2b53c';
  ctx.fill();
}

function drawPawn(ctx, x, y, r, pal, { lift = 0, alpha = 1 } = {}) {
  ctx.save();
  ctx.globalAlpha = alpha;
  // Shadow shrinks as the pawn hops
  const sh = 1 - Math.min(0.5, lift / (r * 3));
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.62, r * 0.85 * sh, r * 0.3 * sh, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fill();
  y -= lift;
  // Base
  const bg = ctx.createLinearGradient(x - r, 0, x + r, 0);
  bg.addColorStop(0, pal.dark);
  bg.addColorStop(0.4, pal.base);
  bg.addColorStop(1, pal.dark);
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.45, r * 0.8, r * 0.32, 0, 0, Math.PI * 2);
  ctx.fillStyle = bg;
  ctx.fill();
  // Body
  ctx.beginPath();
  ctx.moveTo(x - r * 0.72, y + r * 0.42);
  ctx.quadraticCurveTo(x - r * 0.25, y + r * 0.1, x - r * 0.22, y - r * 0.35);
  ctx.lineTo(x + r * 0.22, y - r * 0.35);
  ctx.quadraticCurveTo(x + r * 0.25, y + r * 0.1, x + r * 0.72, y + r * 0.42);
  ctx.closePath();
  ctx.fillStyle = bg;
  ctx.fill();
  // Head
  const hg = ctx.createRadialGradient(x - r * 0.15, y - r * 0.72, r * 0.05, x, y - r * 0.55, r * 0.48);
  hg.addColorStop(0, '#ffffff');
  hg.addColorStop(0.25, pal.light);
  hg.addColorStop(1, pal.dark);
  ctx.beginPath();
  ctx.arc(x, y - r * 0.55, r * 0.42, 0, Math.PI * 2);
  ctx.fillStyle = hg;
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.06);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.stroke();
  ctx.restore();
}

export function createBoardView(canvas, { onPick } = {}) {
  const ctx = canvas.getContext('2d');
  const staticCanvas = document.createElement('canvas');
  let colours = ['red', 'green', 'yellow', 'blue'];
  let state = null;
  let moves = [];
  let hover = null;
  let W = 0;
  const anims = new Map(); // "corner:token" -> { path, t0, dur }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const css = canvas.getBoundingClientRect().width;
    W = Math.max(1, Math.round(css * dpr));
    canvas.width = canvas.height = W;
    staticCanvas.width = staticCanvas.height = W;
    drawStaticBoard(staticCanvas.getContext('2d'), W, colours);
  }
  new ResizeObserver(resize).observe(canvas);

  const s = () => W / SIZE;
  const toBoard = e => {
    const r = canvas.getBoundingClientRect();
    return [((e.clientY - r.top) / r.height) * SIZE, ((e.clientX - r.left) / r.width) * SIZE];
  };

  // Which move the pointer is on: a movable pawn, or that move's destination square.
  function moveAt(pt) {
    if (!state || !moves.length) return null;
    const layout = tokenLayout(state);
    let best = null, bd = 0.6;
    for (const m of moves) {
      const t = layout.find(l => l.corner === m.corner && l.pos === m.from);
      if (t) {
        const d = Math.hypot(t.point[0] - pt[0], t.point[1] - pt[1]);
        if (d < bd) { bd = d; best = m; }
      }
    }
    if (best) return best;
    const dests = moves.filter(m => {
      const [y, x] = tokenPoint(m.corner, m.to, m.token);
      return Math.abs(y - pt[0]) < 0.5 && Math.abs(x - pt[1]) < 0.5;
    });
    return dests.length === 1 ? dests[0] : null;
  }

  canvas.addEventListener('pointermove', e => {
    hover = moveAt(toBoard(e));
    canvas.style.cursor = hover ? 'pointer' : 'default';
  });
  canvas.addEventListener('pointerleave', () => { hover = null; });
  canvas.addEventListener('click', e => {
    const m = moveAt(toBoard(e));
    if (m && onPick) onPick(m);
  });

  function animPoint(a, now) {
    const t = Math.max(0, now - a.t0);
    if (t >= a.dur) return null;
    const n = a.path.length - 1;
    const f = (t / a.dur) * n;
    const i = Math.min(n - 1, Math.floor(f)), u = f - i;
    const [y0, x0] = a.path[i], [y1, x1] = a.path[i + 1];
    return { point: [y0 + (y1 - y0) * u, x0 + (x1 - x0) * u], lift: Math.sin(u * Math.PI) * (a.hop ?? 0.45) };
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (!W || !state) return;
    const S = s();
    ctx.clearRect(0, 0, W, W);
    ctx.drawImage(staticCanvas, 0, 0);

    const layout = tokenLayout(state);
    const pulse = (Math.sin(now / 220) + 1) / 2;
    const movable = new Set(moves.map(m => `${m.corner}:${m.from}`));

    // Destination preview for the hovered move
    if (hover) {
      const path = movePath(hover);
      ctx.save();
      ctx.setLineDash([S * 0.12, S * 0.14]);
      ctx.lineWidth = S * 0.08;
      ctx.lineCap = 'round';
      ctx.strokeStyle = PALETTE[colours[hover.corner]].dark;
      ctx.beginPath();
      path.forEach(([y, x], i) => ctx[i ? 'lineTo' : 'moveTo'](x * S, y * S));
      ctx.stroke();
      ctx.restore();
      const [ty, tx] = tokenPoint(hover.corner, hover.to, hover.token);
      drawPawn(ctx, tx * S, ty * S, S * 0.36, PALETTE[colours[hover.corner]], { alpha: 0.45 });
    }

    const items = layout.map(t => {
      const a = anims.get(`${t.corner}:${t.token}`);
      const ap = a && animPoint(a, now);
      if (a && !ap && now - a.t0 >= a.dur) anims.delete(`${t.corner}:${t.token}`);
      if (a && now < a.t0) return { ...t, point: a.path[0], lift: 0, scale: 1 };
      return ap ? { ...t, point: ap.point, lift: ap.lift * S, scale: 1, flying: true } : { ...t, lift: 0 };
    });
    items.sort((a, b) => (a.flying ? 1 : 0) - (b.flying ? 1 : 0) || a.point[0] - b.point[0]);

    for (const t of items) {
      const x = t.point[1] * S, y = t.point[0] * S, r = S * 0.36 * t.scale;
      if (!t.flying && movable.has(`${t.corner}:${t.pos}`)) {
        ctx.beginPath();
        ctx.arc(x, y + r * 0.2, r * (1.05 + pulse * 0.2), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${0.35 + pulse * 0.35})`;
        ctx.fill();
        ctx.lineWidth = S * 0.06;
        ctx.strokeStyle = PALETTE[colours[t.corner]].dark;
        ctx.stroke();
      }
      drawPawn(ctx, x, y, r, PALETTE[colours[t.corner]], { lift: t.lift });
    }
  }
  requestAnimationFrame(frame);

  return {
    setColours(c) { colours = c; resize(); },
    setState(st) { state = st; },
    setMoves(ms) { moves = ms; if (hover && !ms.includes(hover)) hover = null; },
    // Animate a move (already applied to the state) and any captures it made.
    animate(move, captured = []) {
      const path = movePath(move);
      const now = performance.now();
      const dur = STEP_MS * (path.length - 1) + (move.from < 0 ? 200 : 0);
      anims.set(`${move.corner}:${move.token}`, { path, t0: now, dur, hop: move.from < 0 ? 1.2 : 0.45 });
      let end = dur;
      for (const c of captured) {
        const from = tokenPoint(c.corner, c.from, c.token);
        const to = YARD_SPOTS[c.corner][c.token];
        anims.set(`${c.corner}:${c.token}`, { path: [from, to], t0: now + dur, dur: 520, hop: 2 });
        end = dur + 520;
      }
      return new Promise(r => setTimeout(r, end + 30));
    },
  };
}
