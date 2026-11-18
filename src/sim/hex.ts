export interface Hex {
  q: number;
  r: number;
}

export function toCube(q: number, r: number): [number, number, number] {
  const x = q;
  const z = r - (q - (q & 1)) / 2;
  const y = -x - z;
  return [x, y, z];
}

export function hexDist(q1: number, r1: number, q2: number, r2: number): number {
  const [x1, y1, z1] = toCube(q1, r1);
  const [x2, y2, z2] = toCube(q2, r2);
  return (Math.abs(x1 - x2) + Math.abs(y1 - y2) + Math.abs(z1 - z2)) / 2;
}

const EVEN_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [0, 1],
];
const ODD_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 1], [1, 0], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

export function neighbors(q: number, r: number): Hex[] {
  const dirs = (q & 1) === 0 ? EVEN_DIRS : ODD_DIRS;
  return dirs.map(([dq, dr]) => ({ q: q + dq, r: r + dr }));
}

export function hexCenterX(q: number): number {
  return q * 1.5;
}

export function hexCenterZ(q: number, r: number): number {
  return Math.sqrt(3) * (r + 0.5 * (q & 1));
}
