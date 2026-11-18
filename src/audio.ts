import { getSettings } from './settings';

export type Sfx = 'click' | 'chime' | 'tick' | 'cannon' | 'fanfare';

let ctx: AudioContext | null = null;
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
