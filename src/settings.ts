export interface Settings {
  /** Hide what the colony has not seen (map fog, hidden units, uncharted panels). */
  fog: boolean;
  /** Small synthesised sound effects. */
  sound: boolean;
}

const KEY = 'newcol-settings';
const DEFAULTS: Settings = { fog: true, sound: true };
let cache: Settings | null = null;

export function getSettings(): Settings {
  if (!cache) {
    cache = { ...DEFAULTS };
    try {
      Object.assign(cache, JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>);
    } catch {
      /* defaults */
    }
  }
  return cache;
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  getSettings()[key] = value;
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* private mode */
  }
}
