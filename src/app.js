import { FINISH, applyMove, hasWon, legalMoves, newState, resolveThrows } from './rules.js';
import { rankPlans } from './engine.js';
import { PALETTE, createBoardView } from './render.js';
import { createDice, playSound } from './dice.js';

const COLOURS = ['red', 'green', 'yellow', 'blue']; // corners clockwise from top-left
const TEAMS = [0, 1, 0, 1];                          // opposite colours are partners
const STORE = 'ludo-table-v1';

const $ = id => document.getElementById(id);
const cap = s => s[0].toUpperCase() + s.slice(1);
const wait = ms => new Promise(r => setTimeout(r, ms));

let g = null; // the game, saved after every step
let selected = 0;
let muted = false;
let toastTimer = 0;

const view = createBoardView($('board'), { onPick: m => humanMove(m) });
const dice = createDice($('cube'));
view.setColours(COLOURS);

// ---------- persistence ----------

function save() {
  try { localStorage.setItem(STORE, JSON.stringify(g)); } catch { /* storage blocked */ }
}
function load() {
  try { return JSON.parse(localStorage.getItem(STORE)); } catch { return null; }
}

// ---------- game flow ----------
// phase: 'roll' (waiting for a throw), 'rolling', 'move' (human picks a pawn),
//        'busy' (animating / computer thinking), 'over'

function newGame(ai, speed) {
  g = {
    ai, speed, state: newState(), seat: 0, throws: [], batch: [], voidSeen: 0,
    bonus: 0, phase: 'roll', winner: null, log: [],
  };
  log(`New game. Computer plays ${COLOURS.filter((_, k) => ai[k]).map(cap).join(' & ') || 'nobody'}.`);
  save();
  render();
  next();
}

const isAI = () => g.ai[g.seat];
const remaining = () => g.batch.filter(d => !d.used).map(d => d.v);
const movesFor = v => legalMoves(g.state, TEAMS, TEAMS[g.seat], v);
const usableIndex = () => g.batch.findIndex(d => !d.used && movesFor(d.v).length);
const name = k => `<b style="color:${PALETTE[COLOURS[k]].light}">${cap(COLOURS[k])}</b>`;

function log(html) {
  g.log.push(html);
  if (g.log.length > 200) g.log.shift();
}

function toast(text, ms = 1600) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

// Kick off whatever the current phase needs (the computer acts on its own).
function next() {
  render();
  if (g.phase === 'roll' && isAI()) setTimeout(() => roll(), 650 * g.speed);
}

async function roll() {
  if (!g || g.phase !== 'roll') return;
  g.phase = 'rolling';
  render();
  const v = 1 + (crypto.getRandomValues(new Uint32Array(1))[0] % 6);
  playSound('roll', muted);
  await dice.roll(v, 900);
  g.throws.push(v);
  const r = resolveThrows(g.throws);
  if (r.voided > g.voidSeen) {
    g.voidSeen = r.voided;
    log(`${name(g.seat)} threw three 6s: they don't count.`);
    toast('Three 6s! They don\'t count. Roll again.', 2000);
  } else if (v === 6) {
    playSound('six', muted);
    toast('Six! Roll again.');
  }
  if (!r.complete) {
    g.phase = 'roll';
    save();
    return next();
  }
  g.batch = r.dice.map(d => ({ v: d, used: false }));
  log(`${name(g.seat)} threw ${r.dice.join(', ')}.`);
  save();
  playMoves();
}

async function playMoves() {
  if (usableIndex() < 0) {
    g.phase = 'busy';
    render();
    toast('No move possible.');
    await wait(1000 * g.speed);
    return endBatch();
  }
  if (isAI()) {
    g.phase = 'busy';
    render();
    await wait(300 * g.speed);
    const { plans } = rankPlans(g.state, TEAMS, g.seat, remaining());
    for (const m of plans[0].moves) {
      await doMove(m);
      await wait(250 * g.speed);
    }
    return endBatch();
  }
  selected = usableIndex();
  g.phase = 'move';
  save();
  render();
  autoMoveIfForced();
}

// With only one possible move left, play it without waiting for a click.
async function autoMoveIfForced() {
  const options = g.batch.flatMap((d, i) => (d.used ? [] : movesFor(d.v).map(m => ({ m, i }))));
  const distinct = new Set(options.map(o => `${o.m.corner}:${o.m.from}:${o.m.to}`));
  if (distinct.size === 1 && remaining().length === 1) {
    await wait(500);
    if (g.phase === 'move') humanMove(options[0].m);
  }
}

async function doMove(m) {
  const die = g.batch.find(d => !d.used && d.v === m.die);
  die.used = true;
  const r = applyMove(g.state, TEAMS, m);
  g.state = r.state;
  g.bonus += r.bonus;
  view.setState(g.state);
  view.setMoves([]);
  playSound('step', muted);
  let text = `${name(m.corner)} ${m.from < 0 ? 'brings a pawn out' : `moves ${m.die}`}`;
  if (r.captured.length) text += `, captures ${r.captured.map(c => name(c.corner)).join(', ')}`;
  if (r.finished) text += ', reaches home';
  log(text + '.');
  render();
  await view.animate(m, r.captured);
  if (r.captured.length) { playSound('capture', muted); toast('Captured! Extra roll.'); }
  else if (r.finished) { playSound('home', muted); toast('Home! Extra roll.'); }
  save();
}

async function humanMove(m) {
  if (!g || g.phase !== 'move' || isAI()) return;
  g.phase = 'busy';
  await doMove(m);
  if (usableIndex() < 0) return endBatch();
  selected = usableIndex();
  g.phase = 'move';
  save();
  render();
  autoMoveIfForced();
}

function endBatch() {
  const team = TEAMS[g.seat];
  g.batch = [];
  g.throws = [];
  g.voidSeen = 0;
  if (hasWon(g.state, TEAMS, team)) {
    g.phase = 'over';
    g.winner = team;
    const names = COLOURS.filter((_, k) => TEAMS[k] === team).map(cap).join(' & ');
    log(`<b>${names} win!</b>`);
    toast(`🏆 ${names} win!`, 6000);
    playSound('home', muted);
    save();
    return render();
  }
  if (g.bonus > 0) {
    g.bonus--;
  } else {
    g.seat = (g.seat + 1) % 4;
  }
  g.phase = 'roll';
  save();
  next();
}

// ---------- rendering ----------

function render() {
  if (!g) return;
  view.setState(g.state);
  const seatColour = PALETTE[COLOURS[g.seat]];

  const turn = $('turn');
  turn.style.background = `linear-gradient(135deg, ${seatColour.light}, ${seatColour.base})`;
  turn.style.color = seatColour.ink;
  turn.innerHTML = g.phase === 'over'
    ? `🏆 ${COLOURS.filter((_, k) => TEAMS[k] === g.winner).map(cap).join(' & ')} win!`
    : `${cap(COLOURS[g.seat])}'s turn <small>${isAI() ? '🤖 Computer' : '🙂 Human'}</small>`;

  const tray = $('dice-btn');
  tray.style.setProperty('--seat', seatColour.base);
  tray.style.setProperty('--seat-glow', seatColour.base + '66');
  const canRoll = g.phase === 'roll' && !isAI();
  tray.disabled = !canRoll;
  tray.classList.toggle('ready', canRoll);

  const hint = {
    roll: isAI() ? 'Computer is rolling…' : 'Click the dice or press Space',
    rolling: 'Rolling…',
    move: g.batch.filter(d => !d.used).length > 1 ? 'Pick a number, then click a glowing pawn' : 'Click a glowing pawn (or its target square)',
    busy: isAI() ? 'Computer is moving…' : '',
    over: 'Game over. Start a new game to play again.',
  }[g.phase];
  $('hint').textContent = hint;

  // Dice chips: voided throws, then this batch (used ones dimmed)
  const voidCount = g.throws.length - (g.batch.length || resolveThrows(g.throws).dice.length);
  const chips = [];
  for (let i = 0; i < voidCount; i++) chips.push(`<button class="chip void" disabled>${g.throws[i]}</button>`);
  if (g.batch.length) {
    g.batch.forEach((d, i) => {
      const usable = !d.used && movesFor(d.v).length > 0;
      const cls = d.used ? 'used' : g.phase === 'move' && i === selected ? 'selected' : '';
      chips.push(`<button class="chip ${cls}" data-i="${i}" ${g.phase === 'move' && usable ? '' : 'disabled'}>${d.v}</button>`);
    });
  } else {
    resolveThrows(g.throws).dice.forEach(v => chips.push(`<button class="chip" disabled>${v}</button>`));
  }
  $('dice-chips').innerHTML = chips.join('');

  view.setMoves(g.phase === 'move' && !isAI() && g.batch[selected] && !g.batch[selected].used ? movesFor(g.batch[selected].v) : []);

  $('players').innerHTML = COLOURS.map((c, k) => {
    const home = g.state.pos[k].filter(p => p === FINISH).length;
    return `<li class="${k === g.seat && g.phase !== 'over' ? 'active' : ''}">
      <span class="dot" style="background:${PALETTE[c].base}"></span>
      <span>${cap(c)} <span class="who">${g.ai[k] ? '🤖' : '🙂'}</span></span>
      <span class="home">🏠 ${home}/4</span></li>`;
  }).join('');

  $('log').innerHTML = g.log.slice().reverse().map(l => `<li>${l}</li>`).join('');
}

// ---------- setup ----------

function openSetup(cancellable) {
  const ai = g?.ai?.slice() || [true, false, true, false];
  const grid = $('seat-grid');
  const draw = () => {
    grid.innerHTML = COLOURS.map((c, k) => `<button type="button" class="seat" data-k="${k}"
      style="background:linear-gradient(135deg, ${PALETTE[c].light}, ${PALETTE[c].base}); color:${PALETTE[c].ink}">
      ${cap(c)}<small>${ai[k] ? '🤖 Computer' : '🙂 Human'}</small></button>`).join('');
  };
  grid.onclick = e => {
    const b = e.target.closest('.seat');
    if (!b) return;
    ai[b.dataset.k] = !ai[b.dataset.k];
    draw();
  };
  draw();
  $('btn-setup-cancel').hidden = !cancellable;
  const dlg = $('setup');
  dlg.onclose = () => {
    if (dlg.returnValue === 'ok') newGame(ai, Number($('opt-speed').value));
  };
  dlg.oncancel = e => { if (!cancellable) e.preventDefault(); };
  dlg.returnValue = '';
  dlg.showModal();
}

// ---------- wiring ----------

$('dice-btn').onclick = () => roll();
$('dice-chips').onclick = e => {
  const b = e.target.closest('.chip[data-i]');
  if (!b || b.disabled) return;
  selected = Number(b.dataset.i);
  render();
};
document.addEventListener('keydown', e => {
  if ($('setup').open) return;
  if (e.code === 'Space' || e.code === 'Enter') {
    e.preventDefault();
    if (g?.phase === 'roll' && !isAI()) roll();
  }
  const n = Number(e.key);
  if (g?.phase === 'move' && n >= 1 && n <= g.batch.length && !g.batch[n - 1].used) { selected = n - 1; render(); }
});
$('btn-new').onclick = () => openSetup(true);
$('btn-sound').onclick = () => {
  muted = !muted;
  $('btn-sound').textContent = muted ? '🔇' : '🔊';
};

// Resume a saved game, or start with the setup dialog.
const saved = load();
if (saved?.state) {
  g = saved;
  // A reload mid-animation: pick up from a stable point.
  if (g.phase === 'rolling') g.phase = 'roll';
  if (g.phase === 'busy' || g.phase === 'move') {
    if (g.batch.some(d => !d.used)) playMoves();
    else endBatch();
  } else {
    next();
  }
} else {
  openSetup(false);
}
