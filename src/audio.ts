import { getSettings } from './settings';

export type Sfx = 'click' | 'chime' | 'tick' | 'cannon' | 'fanfare';

let ctx: AudioContext | null = null;
let musicTimer: ReturnType<typeof setInterval> | null = null;
let musicNodes: OscillatorNode[] = [];
const CHORDS = [[98, 123, 147], [87, 110, 131], [98, 131, 165], [82, 110, 131]];
let chordIdx = 0;

function stopMusic(): void {
  if (musicTimer) clearInterval(musicTimer);
  musicTimer = null;
  for (const o of musicNodes) { try { o.stop(); } catch { /* gone */ } }
  musicNodes = [];
}

/** A wandering minor-key pad: three detuned sines, a new chord every eight seconds. */
export function setMusic(on: boolean): void {
  if (!on) { stopMusic(); return; }
  if (musicTimer) return;
  const play = () => {
    if (!getSettings().music) { stopMusic(); return; }
    try {
      ctx ??= new AudioContext();
      if (ctx.state === 'suspended') void ctx.resume();
      for (const o of musicNodes) { try { o.stop(); } catch { /* gone */ } }
      musicNodes = [];
      const chord = CHORDS[chordIdx++ % CHORDS.length];
      const t0 = ctx.currentTime;
      for (const f of chord) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(0.012, t0 + 2.5);
        g.gain.linearRampToValueAtTime(0.0001, t0 + 8.4);
        o.connect(g).connect(ctx!.destination);
        o.start(t0);
        o.stop(t0 + 8.5);
        musicNodes.push(o);
      }
    } catch { /* no audio */ }
  };
  play();
  musicTimer = setInterval(play, 8000);
}
let lastClick = 0;

/** Tiny synthesised sound effects — no assets, no network. */
export function sfx(name: Sfx): void {
  if (!getSettings().sound) return;
  if (name === 'click') {
    const now = performance.now();
    if (now - lastClick < 40) return;
    lastClick = now;
  }
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime;
    const tone = (f0: number, f1: number, dur: number, type: OscillatorType, gain: number, delay = 0): void => {
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t0 + delay);
      o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + delay + dur);
      g.gain.setValueAtTime(gain, t0 + delay);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + dur);
      o.connect(g).connect(ctx!.destination);
      o.start(t0 + delay);
      o.stop(t0 + delay + dur + 0.02);
    };
    if (name === 'click') tone(320, 220, 0.05, 'triangle', 0.02);
    else if (name === 'chime') { tone(660, 880, 0.12, 'sine', 0.05); tone(880, 1320, 0.18, 'sine', 0.04, 0.09); }
    else if (name === 'tick') tone(180, 140, 0.06, 'square', 0.015);
    else if (name === 'cannon') tone(90, 40, 0.25, 'sawtooth', 0.08);
    else if (name === 'fanfare') [523, 659, 784, 1046].forEach((f, i) => tone(f, f * 1.01, 0.16, 'sine', 0.05, i * 0.12));
  } catch {
    /* no audio hardware in this context */
  }
}
