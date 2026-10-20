import { SIZE, SAFE_SQUARES, cellKey, loopIndex, posForCell, zoneAt } from './board.js';
import { FINISH, YARD, cloneState, enumeratePlans, hasWon, newState, resolveThrows, stateKey } from './rules.js';
import { rankPlans } from './engine.js';
import { analyze, boardToImage, calibrate, detectState, matchPlans, scoreState } from './vision.js';
import { PALETTE, drawBoard, drawPhoto, tokenLayout } from './render.js';

const COLOURS = ['red', 'green', 'yellow', 'blue'];
const STORE = 'ludo-player-game-v1';
const MAX_PHOTO = 1280;

const $ = id => document.getElementById(id);
const cap = s => s[0].toUpperCase() + s.slice(1);

let game = null;         // persisted
let photo = null;        // { canvas, imageData, corners, analysis, forKey }
let ui = { editing: false, selected: null, showAll: false, chosen: 0, ranked: null, matches: null, remark: null };

// ---------- persistence ----------

function save() {
  try { localStorage.setItem(STORE, JSON.stringify(game)); } catch { /* storage full or blocked: keep playing */ }
}
function load() {
  try { return JSON.parse(localStorage.getItem(STORE)); } catch { return null; }
}
function compactCalib(c) {
  const round = a => a.map(v => Math.round(v));
  const reference = {};
  for (const [k, px] of Object.entries(c.reference)) reference[k] = px.map(round);
  return { corners: c.corners, tokenColors: c.tokenColors.map(round), reference, refLum: c.refLum };
}

// ---------- screens ----------

function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
  window.scrollTo(0, 0);
}

function home() {
  $('btn-continue').hidden = !load()?.calib;
  show('screen-home');
}

// ---------- camera ----------

function frameToImage(source, w, h) {
  const scale = Math.min(1, MAX_PHOTO / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return { canvas, imageData: ctx.getImageData(0, 0, canvas.width, canvas.height) };
}

function takePhoto(message = 'Hold the phone over the board so all of it fits.') {
  return new Promise(resolve => {
    const video = $('camera-video');
    let stream = null;
    const finish = result => {
      if (stream) stream.getTracks().forEach(t => t.stop());
      video.srcObject = null;
      $('camera').hidden = true;
      $('btn-cam-shoot').onclick = $('btn-cam-cancel').onclick = $('cam-file').onchange = null;
      resolve(result);
    };
    $('camera-msg').textContent = message;
    $('camera').hidden = false;
    $('btn-cam-shoot').disabled = true;

    navigator.mediaDevices?.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
      audio: false,
    }).then(s => {
      stream = s;
      video.srcObject = s;
      $('btn-cam-shoot').disabled = false;
    }).catch(() => {
      $('camera-msg').textContent = 'Camera not available here. Tap Gallery to use the phone camera or pick a photo.';
    });

    $('btn-cam-shoot').onclick = () => {
      if (!video.videoWidth) return;
      finish(frameToImage(video, video.videoWidth, video.videoHeight));
    };
    $('btn-cam-cancel').onclick = () => finish(null);
    $('cam-file').onchange = e => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      const img = new Image();
      img.onload = () => { finish(frameToImage(img, img.naturalWidth, img.naturalHeight)); URL.revokeObjectURL(img.src); };
      img.src = URL.createObjectURL(file);
    };
  });
}

// Tap position on a canvas in canvas pixels.
function canvasPoint(canvas, e) {
  const r = canvas.getBoundingClientRect();
  return [(e.clientX - r.left) * (canvas.width / r.width), (e.clientY - r.top) * (canvas.height / r.height)];
}

// ---------- setup ----------

let setup = null;

function startSetup() {
  setup = { colours: ['red', 'green', 'yellow', 'blue'], ai: [], first: 0 };
  renderSetup();
  show('screen-setup');
}

function renderSetup() {
  for (const sel of document.querySelectorAll('[data-corner]')) {
    const k = Number(sel.dataset.corner);
    sel.innerHTML = COLOURS.map(c => `<option value="${c}" ${setup.colours[k] === c ? 'selected' : ''}>${cap(c)}</option>`).join('');
    sel.onchange = () => {
      const other = setup.colours.indexOf(sel.value);
      setup.colours[other] = setup.colours[k];
      setup.colours[k] = sel.value;
      renderSetup();
    };
  }
  const chip = (corner, pressed, onclick) => {
    const b = document.createElement('button');
    const pal = PALETTE[setup.colours[corner]];
    b.className = 'chip';
    b.textContent = cap(setup.colours[corner]);
    b.style.background = pal.fill;
    b.style.color = pal.ink;
    b.setAttribute('aria-pressed', String(pressed));
    b.onclick = onclick;
    return b;
  };
  $('ai-chips').replaceChildren(...[0, 1, 2, 3].map(k => chip(k, setup.ai.includes(k), () => {
    setup.ai = setup.ai.includes(k) ? setup.ai.filter(x => x !== k) : [...setup.ai, k].slice(-2);
    renderSetup();
  })));
  $('first-chips').replaceChildren(...[0, 1, 2, 3].map(k => chip(k, setup.first === k, () => { setup.first = k; renderSetup(); })));
}

function finishSetup() {
  if (setup.ai.length !== 2) {
    $('setup-error').textContent = 'Pick exactly two colours for the computer.';
    $('setup-error').hidden = false;
    return;
  }
  $('setup-error').hidden = true;
  game = {
    colours: setup.colours.slice(),
    teams: [0, 1, 2, 3].map(k => (setup.ai.includes(k) ? 0 : 1)), // team 0 = computer
    seat: setup.first,
    throws: [],
    pendingBonus: 0,
    state: newState(),
    history: [],
    calib: null,
    corners: null,
    winner: null,
  };
  startCalibration();
}

// ---------- calibration ----------

let calib = null;

function startCalibration() {
  calib = { step: 'photo', shot: null, corners: [], taps: [] };
  $('calib-canvas').hidden = true;
  $('btn-calib-photo').hidden = false;
  $('btn-calib-photo').textContent = '📷 Take photo';
  $('btn-calib-done').hidden = true;
  $('btn-calib-undo').hidden = true;
  $('calib-prompt').textContent = game.calib
    ? 'Take a photo from straight above with the whole board in view. Tokens can stay where they are.'
    : 'Put every token in its yard, then take a photo from straight above with the whole board in view.';
  show('screen-calibrate');
}

function calibPrompt() {
  const g = game.colours;
  if (calib.corners.length < 4) {
    const k = calib.corners.length;
    return `Tap the outer corner of the ${cap(g[k])} yard (${k + 1}/4).`;
  }
  if (calib.taps.length < 4) return `Tap the middle of one ${cap(g[calib.taps.length])} token.`;
  return 'The grid should sit on the board squares. If it does, tap "Looks right".';
}

function renderCalib() {
  const canvas = $('calib-canvas');
  const done = calib.corners.length === 4;
  drawPhoto(canvas, calib.shot.canvas, {
    H: done ? boardToImage(calib.corners) : null,
    cornerTaps: done ? calib.taps : calib.corners,
    showGrid: done,
  });
  canvas.hidden = false;
  $('calib-prompt').textContent = calibPrompt();
  $('btn-calib-undo').hidden = calib.corners.length === 0;
  $('btn-calib-done').hidden = calib.taps.length < 4;
  $('btn-calib-photo').textContent = '📷 Retake';
}

async function calibPhoto() {
  const shot = await takePhoto(game.calib ? 'Fit the whole board in view.' : 'All tokens in their yards. Fit the whole board in view.');
  if (!shot) return;
  calib = { step: 'tap', shot, corners: [], taps: [] };
  renderCalib();
}

function calibTap(e) {
  if (!calib?.shot) return;
  const p = canvasPoint($('calib-canvas'), e);
  if (calib.corners.length < 4) calib.corners.push(p);
  else if (calib.taps.length < 4) calib.taps.push(p);
  renderCalib();
}

function calibUndo() {
  if (calib.taps.length) calib.taps.pop();
  else calib.corners.pop();
  renderCalib();
}

function calibDone() {
  const c = compactCalib(calibrate(calib.shot.imageData, calib.corners, calib.taps));
  // Re-learning mid-game: squares with tokens on them keep their old empty-board look.
  if (game.calib) {
    game.state.pos.forEach((ps, k) => ps.forEach(p => {
      const key = cellKey(k, p);
      if (key) c.reference[key] = game.calib.reference[key];
    }));
  }
  game.calib = c;
  game.corners = calib.corners;
  photo = null;
  save();
  enterGame();
}

// ---------- game ----------

function enterGame() {
  ui = { editing: false, selected: null, showAll: false, chosen: 0, ranked: null, matches: null, remark: null };
  show('screen-game');
  renderGame();
}

const isAI = seat => game.teams[seat] === 0;
const teamName = team => (team === 0 ? 'Computer' : 'Humans');

function describeMove(m) {
  const c = cap(game.colours[m.corner]);
  const where = p => (p <= 50 ? `step ${p + 1}` : p < FINISH ? `home lane ${p - 50}` : 'HOME');
  let text = m.from === YARD ? `${c}: bring a token out` : `${c}: ${where(m.from)} → ${where(m.to)} (+${m.die})`;
  if (m.captured?.length) text += ` ✂ captures ${m.captured.map(x => cap(game.colours[x.corner])).join(', ')}`;
  else if (m.to <= 50 && SAFE_SQUARES.has(loopIndex(m.corner, m.to)) && m.from !== YARD) text += ' ★ safe';
  return text;
}
const describePlan = plan => (plan.moves.length ? plan.moves.map(describeMove).join(' · ') : 'No move possible');

function setStatus(text, kind = '') {
  $('status').textContent = text;
  $('status').className = `status ${kind}`;
}

function currentPlans() {
  const { dice, complete } = resolveThrows(game.throws);
  if (!complete) return null;
  const key = `${stateKey(game.state)}#${game.seat}#${dice.join()}`;
  if (ui.ranked?.key !== key) {
    const team = game.teams[game.seat];
    const plans = isAI(game.seat)
      ? rankPlans(game.state, game.teams, game.seat, dice).plans
      : enumeratePlans(game.state, game.teams, team, dice);
    ui.ranked = { key, plans };
    ui.chosen = 0;
    ui.matches = null;
    ui.showAll = false;
  }
  return ui.ranked.plans;
}

function renderGame() {
  const seat = game.seat;
  const colour = game.colours[seat];
  const label = $('turn-label');
  label.textContent = game.winner !== null ? `${teamName(game.winner)} win!` : `${cap(colour)} · ${isAI(seat) ? 'Computer' : 'Human'}`;
  label.style.background = PALETTE[colour].fill;
  label.style.color = PALETTE[colour].ink;

  // Dice
  const { dice, voided } = resolveThrows(game.throws);
  const voidCount = game.throws.length - dice.length;
  $('dice-seq').innerHTML = game.throws.map((d, i) => `<span class="die ${i < voidCount ? 'void' : ''}">${d}</span>`).join('');
  const complete = resolveThrows(game.throws).complete;
  for (const b of document.querySelectorAll('[data-die]')) b.disabled = complete || game.winner !== null || ui.editing;

  $('edit-banner').hidden = !ui.editing;
  $('dice-panel').hidden = ui.editing;

  let moves = [];
  const panel = $('action-panel');
  const buttons = [];
  let text = '';

  if (game.winner !== null) {
    setStatus(`${teamName(game.winner)} have all tokens home. 🎉`, 'good');
    panel.hidden = true;
  } else if (ui.editing) {
    setStatus('');
    panel.hidden = true;
  } else if (!complete) {
    panel.hidden = true;
    if (voided && !dice.length) setStatus('Three 6s: those throws don\'t count. Throw again.', 'warn');
    else if (dice.length && dice[dice.length - 1] === 6) setStatus('A 6! Throw again and enter it.');
    else if (game.pendingBonusShown) setStatus(game.pendingBonusShown, 'good');
    else setStatus(`Enter ${cap(colour)}'s throw${isAI(seat) ? ' for the computer' : ''}.`);
  } else {
    panel.hidden = false;
    setStatus('');
    const plans = currentPlans();
    if (isAI(seat)) ({ text, moves } = aiPanel(plans, buttons));
    else ({ text, moves } = humanPanel(plans, buttons));
  }
  $('action-text').innerHTML = text;
  $('action-buttons').replaceChildren(...buttons);

  drawBoard($('board'), game.state, game.colours, { moves, selected: ui.selected });
  renderPhoto(moves);
}

function button(label, onclick, cls = '') {
  const b = document.createElement('button');
  b.innerHTML = label;
  b.className = cls;
  b.onclick = onclick;
  return b;
}

function aiPanel(plans, buttons) {
  const plan = plans[ui.chosen];
  if (!plan.moves.length) {
    buttons.push(button('Next turn', () => applyPlan(plan), 'primary'));
    return { text: '<strong>No legal move</strong> with these throws.', moves: [] };
  }
  const steps = plan.moves.map((m, i) => `<li>${describeMove(m)}</li>`).join('');
  const text = `<strong>${ui.chosen === 0 ? 'Best move' : `Option ${ui.chosen + 1}`}</strong><ol>${steps}</ol>`;
  buttons.push(button('📷 Show it on a photo of the board', () => capture('ai')));
  buttons.push(button('✓ Done, I moved it', () => applyPlan(plan), 'primary'));
  if (plans.length > 1) {
    buttons.push(button(ui.showAll ? 'Hide other options' : `Other options (${plans.length - 1})`, () => { ui.showAll = !ui.showAll; renderGame(); }));
    if (ui.showAll) plans.slice(0, 8).forEach((p, i) => {
      buttons.push(button(`${describePlan(p)} <span class="plan-score">${p.score.toFixed(0)}</span>`, () => { ui.chosen = i; renderGame(); }, `option ${i === ui.chosen ? 'best' : ''}`));
    });
  }
  return { text, moves: plan.moves };
}

function humanPanel(plans, buttons) {
  const real = plans.filter(p => p.moves.length);
  if (!real.length) {
    buttons.push(button('Next turn', () => applyPlan(plans[0]), 'primary'));
    return { text: '<strong>No legal move</strong> with these throws.', moves: [] };
  }
  if (ui.matches) {
    const best = ui.matches[ui.chosen];
    let text = `<strong>Looks like:</strong> ${describePlan(best.plan)}`;
    if (ui.mismatch) text += `<p class="status warn">The photo doesn't fit any legal move well. Check the arrows, pick from the list, or edit the board by hand.</p>`;
    buttons.push(button('✓ Correct', () => applyPlan(best.plan), 'primary'));
    ui.matches.slice(0, 6).forEach((m, i) => {
      if (i !== ui.chosen) buttons.push(button(describePlan(m.plan), () => { ui.chosen = i; renderGame(); }, 'option'));
    });
    buttons.push(button('📷 Retake photo', () => capture('human')));
    buttons.push(button('🎯 Grid is off: re-mark corners', () => remarkCorners()));
    if (ui.mismatch) buttons.push(button('✏️ Use what the camera sees, then fix by hand', () => adoptDetected()));
    return { text, moves: best.plan.moves };
  }
  const text = real.length === 1
    ? `Only one move is possible: <strong>${describePlan(real[0])}</strong>`
    : `Move the tokens, then take a photo.`;
  if (real.length === 1) buttons.push(button('✓ That\'s what they did', () => applyPlan(real[0]), 'primary'));
  buttons.push(button('📷 Capture board after the move', () => capture('human'), real.length === 1 ? '' : 'primary'));
  buttons.push(button(ui.showAll ? 'Hide list' : `Pick the move from a list (${real.length})`, () => { ui.showAll = !ui.showAll; renderGame(); }));
  if (ui.showAll) real.forEach(p => buttons.push(button(describePlan(p), () => applyPlan(p), 'option')));
  return { text, moves: [] };
}

function renderPhoto(moves) {
  const canvas = $('photo');
  // Show the photo while it still describes the board (or is being checked / used for edits).
  const relevant = photo && (ui.matches || ui.editing || photo.forKey === stateKey(game.state));
  if (!relevant) { canvas.hidden = true; return; }
  const H = boardToImage(photo.corners);
  if (ui.remark) {
    drawPhoto(canvas, photo.canvas, { cornerTaps: ui.remark, showGrid: false });
  } else if (ui.matches && !ui.editing) {
    const plan = ui.matches[ui.chosen].plan;
    drawPhoto(canvas, photo.canvas, { H, colours: game.colours, state: plan.state, moves: plan.moves });
  } else {
    drawPhoto(canvas, photo.canvas, { H, colours: game.colours, state: game.state, moves: ui.editing ? [] : moves });
  }
  canvas.hidden = false;
}

async function capture(kind) {
  const shot = await takePhoto(kind === 'ai' ? 'Take the board as it is now.' : 'Take the board after their move.');
  if (!shot) return;
  setStatus('Reading the board…');
  await new Promise(r => setTimeout(r, 20));
  photo = { ...shot, corners: game.corners, forKey: stateKey(game.state) };
  readPhoto(kind);
}

function readPhoto(kind) {
  photo.analysis = analyze(photo.imageData, game.calib, photo.corners);
  ui.mismatch = false;
  if (kind === 'human') {
    const plans = currentPlans();
    ui.matches = matchPlans(photo.analysis, plans);
    ui.chosen = 0;
    const freeScore = scoreState(photo.analysis, detectState(photo.analysis, game.state));
    ui.mismatch = freeScore - ui.matches[0].match > 1.5;
  } else {
    const here = scoreState(photo.analysis, game.state);
    const seen = scoreState(photo.analysis, detectState(photo.analysis, game.state));
    ui.mismatch = seen - here > 1.5;
  }
  photo.kind = kind;
  renderGame();
  if (kind === 'ai' && ui.mismatch) setStatus('The photo doesn\'t quite match the saved board. If tokens are wrong, use ✏️ Edit board.', 'warn');
  $('photo').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function adoptDetected() {
  pushHistory('edit', 'Board taken from photo');
  game.state = detectState(photo.analysis, game.state);
  ui.matches = null;
  photo.forKey = stateKey(game.state);
  save();
  ui.editing = true;
  renderGame();
}

function remarkCorners() {
  ui.remark = [];
  setStatus(`Tap the outer corner of the ${cap(game.colours[0])} yard (1/4).`);
  renderGame();
  $('photo').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function photoTap(e) {
  if (!ui.remark) return;
  ui.remark.push(canvasPoint($('photo'), e));
  if (ui.remark.length === 4) {
    photo.corners = ui.remark;
    game.corners = ui.remark;
    ui.remark = null;
    save();
    readPhoto(photo.kind);
    return;
  }
  renderGame();
  setStatus(`Tap the outer corner of the ${cap(game.colours[ui.remark.length])} yard (${ui.remark.length + 1}/4).`);
}

function pushHistory(kind, text, extra = {}) {
  game.history.push({
    kind, text, seat: game.seat, throws: game.throws.slice(),
    before: { state: cloneState(game.state), seat: game.seat, throws: game.throws.slice(), pendingBonus: game.pendingBonus, winner: game.winner },
    ...extra,
  });
  if (game.history.length > 300) game.history.shift();
}

function applyPlan(plan) {
  const { dice } = resolveThrows(game.throws);
  pushHistory('turn', `${cap(game.colours[game.seat])} threw ${dice.join(', ') || '-'}: ${describePlan(plan)}`);
  const wasHumanPhoto = photo && ui.matches;
  game.state = cloneState(plan.state);
  game.throws = [];
  game.pendingBonus += plan.bonus;
  game.pendingBonusShown = null;
  ui.matches = null;
  ui.showAll = false;
  // A photo taken after a human move shows the new board, so the next turn can reuse it.
  if (wasHumanPhoto) photo.forKey = stateKey(game.state);

  const team = game.teams[game.seat];
  if (hasWon(game.state, game.teams, team)) game.winner = team;
  else if (game.pendingBonus > 0) {
    game.pendingBonus--;
    game.pendingBonusShown = `Extra throw for ${cap(game.colours[game.seat])} (capture or token home). Enter it.`;
  } else {
    game.seat = (game.seat + 1) % 4;
  }
  save();
  renderGame();
}

function addThrow(d) {
  game.throws.push(d);
  if (resolveThrows(game.throws).complete) game.pendingBonusShown = null;
  save();
  setStatus(isAI(game.seat) && resolveThrows(game.throws).complete ? 'Thinking…' : '');
  setTimeout(renderGame, 10);
}

function undo() {
  const h = game.history.pop();
  if (!h) { setStatus('Nothing to undo.'); return; }
  Object.assign(game, cloneDeep(h.before));
  game.pendingBonusShown = null;
  ui.matches = null;
  save();
  renderGame();
  setStatus(`Undid: ${h.text}`);
}
const cloneDeep = o => JSON.parse(JSON.stringify(o));

function boardTap(e) {
  if (!ui.editing) return;
  const canvas = $('board');
  const [px, py] = canvasPoint(canvas, e);
  const pt = [(py / canvas.height) * SIZE, (px / canvas.width) * SIZE];
  if (!ui.selected) {
    let best = null, bd = 0.6;
    for (const t of tokenLayout(game.state)) {
      const d = Math.hypot(t.point[0] - pt[0], t.point[1] - pt[1]);
      if (d < bd) { bd = d; best = t; }
    }
    ui.selected = best;
    renderGame();
    return;
  }
  const { corner, token } = ui.selected;
  const zone = zoneAt(pt);
  let to = null;
  if (zone?.yard === corner) to = YARD;
  else if (zone?.finish) to = FINISH;
  else if (zone?.key) to = posForCell(corner, zone.key);
  if (to === null) {
    // Tapped another token or a square this colour can't use: treat as a new selection.
    ui.selected = null;
    boardTap(e);
    return;
  }
  pushHistory('edit', `Moved a ${cap(game.colours[corner])} token by hand`);
  game.state.pos[corner][token] = to;
  ui.selected = null;
  ui.ranked = null;
  save();
  renderGame();
}

function renderHistory() {
  const el = $('history');
  el.hidden = !el.hidden;
  el.innerHTML = '<h3>History</h3>' + (game.history.length
    ? game.history.slice().reverse().map(h => `<div class="history-item">${h.text}</div>`).join('')
    : '<p class="hint">Nothing yet.</p>');
}

// ---------- wiring ----------

$('btn-new').onclick = startSetup;
$('btn-continue').onclick = () => { game = load(); enterGame(); };
$('btn-setup-back').onclick = home;
$('btn-setup-next').onclick = finishSetup;
$('btn-calib-photo').onclick = calibPhoto;
$('btn-calib-undo').onclick = calibUndo;
$('btn-calib-done').onclick = calibDone;
$('calib-canvas').addEventListener('click', calibTap);
$('photo').addEventListener('click', photoTap);
$('board').addEventListener('click', boardTap);
for (const b of document.querySelectorAll('[data-die]')) b.onclick = () => addThrow(Number(b.dataset.die));
$('btn-dice-clear').onclick = () => { game.throws = []; save(); renderGame(); };
$('btn-prev-seat').onclick = () => { game.seat = (game.seat + 3) % 4; game.throws = []; save(); renderGame(); };
$('btn-next-seat').onclick = () => { game.seat = (game.seat + 1) % 4; game.throws = []; save(); renderGame(); };
$('btn-menu').onclick = () => { $('menu').hidden = !$('menu').hidden; };
$('menu').addEventListener('click', () => { $('menu').hidden = true; });
$('btn-edit').onclick = () => { ui.editing = true; ui.selected = null; renderGame(); };
$('btn-edit-done').onclick = () => {
  ui.editing = false;
  ui.selected = null;
  ui.ranked = null;
  if (photo) photo.forKey = stateKey(game.state); // the board was fixed to match the photo
  renderGame();
};
$('btn-undo').onclick = undo;
$('btn-recalibrate').onclick = () => {
  if (confirm('Re-learning needs a photo with every token in its yard. The current position is kept. Continue?')) startCalibration();
};
$('btn-history').onclick = renderHistory;
$('btn-quit').onclick = () => { if (confirm('Leave this game and start a new one?')) home(); };

home();
