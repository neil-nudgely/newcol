// Colony codes: the deterministic core makes a game reproducible from its seed plus the
// ordered list of player actions — a save the size of a paragraph, and the ground under
// future async play (send your log to a friend; they replay your colony to the same turn).
import { createGame, eventChoice } from './sim/state';
import * as sim from './sim/sim';
import type { GameState, Owner } from './sim/types';

export interface ActionEntry {
  t: number;
  a: string;
  args: unknown[];
}

/** Append the player's action to the replay log. Call only after the action succeeded. */
export function rec(s: GameState, a: string, args: unknown[] = []): void {
  (s.actionLog ?? (s.actionLog = [])).push({ t: s.turn, a, args });
}

export interface ColonyCode {
  seed: number;
  player: Owner;
  rivalCount: number;
  log: ActionEntry[];
}

export function encodeCode(s: GameState): string {
  const code: ColonyCode = { seed: s.seed, player: s.player, rivalCount: s.rivals.length, log: s.actionLog ?? [] };
  return btoa(unescape(encodeURIComponent(JSON.stringify(code))));
}

/** Rebuild a game state by replaying a colony code. Returns null if the code is corrupt. */
export function replayGame(code: string): GameState | null {
  let parsed: ColonyCode;
  try {
    parsed = JSON.parse(decodeURIComponent(escape(atob(code.trim())))) as ColonyCode;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed.seed !== 'number' || !Array.isArray(parsed.log) || parsed.log.length === 0) return null;
  const s = createGame(parsed.seed, parsed.player, parsed.rivalCount);
  for (const e of parsed.log) {
    const a = e.args;
    switch (e.a) {
      case 'endTurn': sim.endTurn(s); break;
      case 'choice': { const ev = s.pendingEvents[0]; if (ev) eventChoice(s, ev.id, Number(a[0])); break; }
      case 'move': sim.moveUnit(s, Number(a[0]), Number(a[1]), Number(a[2])); break;
      case 'found': sim.foundTown(s, s.player, Number(a[0])); break;
      case 'build': sim.buildImprovement(s, s.player, Number(a[0]), a[1] as never); break;
      case 'train': sim.trainUnit(s, s.player, Number(a[0]), a[1] as never); break;
      case 'ship': sim.sendShip(s, Number(a[0]), a[1] as never); break;
      case 'wagons': sim.sendWagons(s, Number(a[0]), a[1] as never); break;
      case 'buyEurope': sim.buyFromEurope(s, Number(a[0]), a[1] as never, Number(a[2])); break;
      case 'founder': sim.buyFounder(s, String(a[0])); break;
      case 'tech': sim.buyTech(s, String(a[0])); break;
      case 'demand': sim.fulfillDemand(s, s.player, Number(a[0])); break;
      case 'land': sim.buyLand(s, s.player, Number(a[0])); break;
      case 'road': sim.buildRoad(s, s.player, Number(a[0]), Number(a[1])); break;
      case 'fine': sim.payFine(s, Number(a[0])); break;
      case 'bombard': sim.bombardFrigate(s, Number(a[0]), Number(a[1])); break;
      case 'declare': sim.declare(s, a[0] as never); break;
      case 'resume': sim.resumeTrade(s); break;
      case 'gift': sim.giftTribe(s, Number(a[0])); break;
      case 'trade': sim.openTrade(s, Number(a[0])); break;
      case 'sell': sim.sellToTribe(s, s.player, Number(a[0]), a[1] as never); break;
      default: break;
    }
  }
  return s;
}
