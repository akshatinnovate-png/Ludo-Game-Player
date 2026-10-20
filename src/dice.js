// A 3D CSS dice that tumbles and lands on a given face.

const PIPS = {
  1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9],
};
// Cube rotation [x, y] (degrees) that brings each face to the front.
const FACE_ROTATION = { 1: [0, 0], 2: [0, -90], 3: [-90, 0], 4: [90, 0], 5: [0, 90], 6: [0, 180] };

export function createDice(cube) {
  cube.innerHTML = [1, 2, 3, 4, 5, 6].map(n =>
    `<div class="face face-${n}">${Array.from({ length: 9 }, (_, i) => `<span class="${PIPS[n].includes(i + 1) ? 'pip' : ''}"></span>`).join('')}</div>`,
  ).join('');
  let rx = -20, ry = 25, spins = 0;
  cube.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;

  return {
    roll(value, ms = 900) {
      spins += 2;
      const [fx, fy] = FACE_ROTATION[value];
      rx = spins * 360 + fx;
      ry = spins * 360 + fy;
      cube.style.transition = `transform ${ms}ms cubic-bezier(.17,.84,.32,1.05)`;
      cube.parentElement.classList.remove('bounce');
      void cube.offsetWidth;
      cube.parentElement.classList.add('bounce');
      cube.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;
      return new Promise(r => setTimeout(r, ms));
    },
  };
}

// Short synthesized sounds, so there are no audio files to load.
let audio = null;
export function playSound(kind, muted) {
  if (muted) return;
  try {
    audio ||= new AudioContext();
    const t = audio.currentTime;
    const blip = (freq, at, dur, type = 'triangle', vol = 0.12) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t + at);
      g.gain.setValueAtTime(vol, t + at);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
      o.connect(g).connect(audio.destination);
      o.start(t + at);
      o.stop(t + at + dur);
    };
    if (kind === 'roll') for (let i = 0; i < 6; i++) blip(180 + Math.random() * 220, i * 0.11, 0.05, 'square', 0.05);
    if (kind === 'step') blip(660, 0, 0.06);
    if (kind === 'capture') { blip(300, 0, 0.12, 'sawtooth', 0.08); blip(180, 0.1, 0.2, 'sawtooth', 0.08); }
    if (kind === 'home') { blip(523, 0, 0.12); blip(659, 0.1, 0.12); blip(784, 0.2, 0.25); }
    if (kind === 'six') { blip(880, 0, 0.08); blip(1175, 0.08, 0.12); }
  } catch { /* audio unavailable */ }
}
