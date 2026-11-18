import './styles.css';
import { getSettings, setSetting } from './settings';
import { sfx } from './audio';
import { rec, replayGame } from './replay';
import { createGame, eventChoice, saveGame, loadGame } from './sim/state';
import { buildRoad,
  endTurn, foundTown, buildImprovement, giftTribe, openTrade, declare,
  moveUnit, reachableTiles, sendShip, sendWagons, sellToTribe, trainUnit, payFine, bombardFrigate, buyTech, buyFromEurope, buyFounder, fulfillDemand, buyLand, resumeTrade,
} from './sim/sim';
import { scene } from './render/scene';
import { ui } from './ui/ui';
import { hexDist } from './sim/hex';
import { GOODS } from './sim/goods';
import type { GameState, GoodId, ImprovementId, UnitKind, Owner } from './sim/types';

interface Selection {
  q: number;
  r: number;
  unitId: number | null;
}

let s: GameState;
let sel: Selection | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

const seedParam = new URLSearchParams(location.search).get('seed');
const URL_SEED = seedParam ? parseInt(seedParam, 10) || 1607 : 1607;

function stage(): HTMLElement {
  return document.getElementById('stage')!;
}

function flash(msg: string): void {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.getElementById('ui')?.appendChild(t) ?? document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t!.classList.add('hidden'), 2600);
}

function syncSelection(): void {
  if (sel?.unitId != null) {
    const u = s.units.find((x) => x.id === sel!.unitId);
    if (!u) {
      sel = { q: sel.q, r: sel.r, unitId: null };
    }
  }
  let reach: Array<{ q: number; r: number }> = [];
  if (sel?.unitId != null) {
    const u = s.units.find((x) => x.id === sel!.unitId);
    if (u && u.owner === s.player && u.moveLeft > 0) {
      reach = reachableTiles(s, u).map((t) => ({ q: t.q, r: t.r }));
    }
  }
  scene.setReachable(reach);
  scene.select(sel ? { q: sel.q, r: sel.r, unitId: sel.unitId ?? undefined } : null);
  ui.selected = sel ? { q: sel.q, r: sel.r, unitId: sel.unitId ?? undefined } : null;
}


/** Adopt an externally rebuilt state (colony code replay). */
function adopt(next: GameState): void {
  s = next;
  scene.dispose();
  scene.init(stage(), s);
  afterChange();
}

function afterChange(): void {
  {
    const pend = s.pendingEvents.length;
    if (pend > (window as unknown as { __pend?: number }).__pend!) sfx('chime');
    (window as unknown as { __pend?: number }).__pend = pend;
    const head = s.log[0] ?? '';
    if (head !== (window as unknown as { __log?: string }).__log) {
      (window as unknown as { __log?: string }).__log = head;
      if (/storm|destroyed|broke|withdraws|Falls|repelled|Skirmish/i.test(head)) sfx('cannon');
      else if (/reaches Europe/i.test(head)) sfx('fanfare');
    }
    if (s.victory && !(window as unknown as { __won?: boolean }).__won) {
      (window as unknown as { __won?: boolean }).__won = true;
      sfx('fanfare');
    }
  }
  scene.refresh(s);
  syncSelection();
  ui.refresh();
}

function selectTile(q: number, r: number): void {
  if (sel?.unitId != null) {
    const u = s.units.find((x) => x.id === sel!.unitId);
    if (u && u.owner === s.player) {
      if (u.q === q && u.r === r) {
        const stack = s.units.filter((x) => x.q === q && x.r === r);
        if (stack.length > 1) {
          const i = stack.findIndex((x) => x.id === u.id);
          const next = stack[(i + 1) % stack.length];
          sel = { q, r, unitId: next.id };
          afterChange();
          return;
        }
      } else if (u.moveLeft > 0) {
        const err = moveUnit(s, u.id, q, r);
        if (!err) {
          rec(s, 'move', [u.id, q, r]);
          sel = { q, r, unitId: u.id };
          afterChange();
          return;
        }
        flash(err);
      }
    }
  }
  const unit = s.units.find((x) => x.q === q && x.r === r);
  const tileIdx = r * s.mapW + q;
  const knowable = unit && (unit.owner === s.player || !getSettings().fog || s.visible[tileIdx]);
  sel = knowable ? { q, r, unitId: unit!.id } : { q, r, unitId: null };
  afterChange();
}

let chosenPlayer: Owner = 'england';
let chosenRivalCount = 1;

function start(seed: number, player: Owner, rivalCount: number): void {
  s = createGame(seed, player, rivalCount);
  scene.dispose();
  scene.init(stage(), s);
  ui.setState(s);
  const first = s.units.find((u) => u.owner === s.player);
  sel = first ? { q: first.q, r: first.r, unitId: first.id } : null;
  ui.showIntro = false;
  afterChange();
}

function newGame(): void {
  s = createGame(URL_SEED, chosenPlayer, chosenRivalCount);
  scene.dispose();
  scene.init(stage(), s);
  ui.setState(s);
  sel = null;
  ui.showIntro = true;
  ui.showIntroCard(s);
}

ui.init({
  onEndTurn: () => {
    rec(s, 'endTurn');
    endTurn(s);
    sfx('tick');
    afterChange();
  },
  onFoundTown: (unitId) => {
    const u = s.units.find((x) => x.id === unitId);
    if (!u) return;
    const err = foundTown(s, s.player, unitId);
    if (err) {
      flash(err);
    } else {
      rec(s, 'found', [unitId]);
      sel = { q: u.q, r: u.r, unitId: null };
    }
    afterChange();
  },
  onUnitWait: (unitId) => {
    const u = s.units.find((x) => x.id === unitId);
    if (u) u.moveLeft = 0;
    afterChange();
  },
  onUnitView: (unitId) => {
    const u = s.units.find((x) => x.id === unitId);
    if (!u) return;
    sel = { q: u.q, r: u.r, unitId: null };
    afterChange();
  },
  onBombard: (frigateId, townId) => {
    const err = bombardFrigate(s, frigateId, townId);
    if (err) flash(err);
    else rec(s, 'bombard', [frigateId, townId]);
    afterChange();
  },
  onSendShip: (townId: number) => {
    const amounts: Partial<Record<GoodId, number>> = {};
    for (const g of GOODS) {
      const n = ui.qty(townId, g.id);
      if (n > 0) amounts[g.id] = n;
    }
    const err = sendShip(s, townId, amounts);
    if (err) {
      flash(err);
    } else {
      rec(s, 'ship', [townId, amounts]);
      ui.clearQty(townId);
    }
    afterChange();
  },
  onBuyEurope: (townId: number, good: GoodId) => {
    const err = buyFromEurope(s, townId, good, 5);
    if (err) flash(err);
    else rec(s, 'buyEurope', [townId, good, 5]);
    afterChange();
  },
  onSendWagons: (townId: number) => {
    const amounts: Partial<Record<GoodId, number>> = {};
    for (const g of GOODS) {
      const n = ui.qty(townId, g.id);
      if (n > 0) amounts[g.id] = n;
    }
    const err = sendWagons(s, townId, amounts);
    if (err) {
      flash(err);
    } else {
      rec(s, 'wagons', [townId, amounts]);
      ui.clearQty(townId);
    }
    afterChange();
  },
  onPayFine: (townId: number) => {
    const err = payFine(s, townId);
    if (err) flash(err);
    else rec(s, 'fine', [townId]);
    afterChange();
  },
  onTrain: (townId: number, kind: UnitKind) => {
    const err = trainUnit(s, s.player, townId, kind);
    if (err) flash(err);
    else rec(s, 'train', [townId, kind]);
    afterChange();
  },
  onBuild: (townId: number, imp: ImprovementId) => {
    const err = buildImprovement(s, s.player, townId, imp);
    if (err) flash(err);
    else rec(s, 'build', [townId, imp]);
    afterChange();
  },
  onGift: (i) => {
    const err = giftTribe(s, i);
    if (err) flash(err);
    else rec(s, 'gift', [i]);
    afterChange();
  },
  onTrade: (i) => {
    const err = openTrade(s, i);
    if (err) flash(err);
    else rec(s, 'trade', [i]);
    afterChange();
  },
  onSellToTribe: (i, good) => {
    const err = sellToTribe(s, s.player, i, good);
    if (err) flash(err);
    else rec(s, 'sell', [i, good]);
    afterChange();
  },
  onEventChoice: (eventId, idx) => {
    eventChoice(s, eventId, idx);
    rec(s, 'choice', [idx]);
    afterChange();
  },
  onNewGame: () => newGame(),
  onDeclare: (kind) => {
    rec(s, 'declare', [kind]);
    declare(s, kind);
    afterChange();
  },
  onResumeTrade: () => {
    const err = resumeTrade(s);
    if (err) flash(err);
    else rec(s, 'resume');
    afterChange();
  },
  onFulfillDemand: (tribeIdx) => {
    const err = fulfillDemand(s, s.player, tribeIdx);
    if (err) flash(err);
    else rec(s, 'demand', [tribeIdx]);
    afterChange();
  },
  onRoad: (fromId, toId) => {
    const err = buildRoad(s, s.player, fromId, toId);
    if (err) flash(err);
    else rec(s, 'road', [fromId, toId]);
    afterChange();
  },
  onBuyLand: (townId) => {
    const err = buyLand(s, s.player, townId);
    if (err) flash(err);
    else rec(s, 'land', [townId]);
    afterChange();
  },
  onBuyFounder: (id) => {
    const err = buyFounder(s, id);
    if (err) flash(err);
    else rec(s, 'founder', [id]);
    afterChange();
  },
  onBuyTech: (id) => {
    const err = buyTech(s, id);
    if (err) flash(err);
    else rec(s, 'tech', [id]);
    afterChange();
  },
  onSetting: (key, value) => {
    setSetting(key, value);
    scene.refresh(s);
    afterChange();
  },
  onAdoptCode: (code) => {
    const st = replayGame(code);
    if (!st) {
      flash('That is not a colony code.');
      return;
    }
    adopt(st);
  },
  onSave: () => {
    saveGame(s);
    flash('Colony saved.');
    afterChange();
  },
  onLoad: () => {
    const g = loadGame();
    if (!g) {
      flash('No saved colony.');
      return;
    }
    s = g;
    sel = null;
    ui.showIntro = false;
    scene.refresh(s);
    ui.setState(s);
    ui.refresh();
    syncSelection();
    flash(`Colony restored to ${g.year}.`);
  },
  onBegin: (seed, player, rivalCount) => {
    chosenPlayer = player;
    chosenRivalCount = rivalCount;
    start(seed, player, rivalCount);
  },
});

scene.onSelectTile(selectTile);
document.addEventListener('click', () => sfx('click'));

let last = performance.now();
function loop(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  scene.update(dt, s);
  requestAnimationFrame(loop);
}

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__game = {
    get state() {
      return s;
    },
    refresh: () => afterChange(),
    foundAtStart: () => {
      const u = s.units.find((x) => x.owner === s.player);
      if (u) foundTown(s, s.player, u.id);
      afterChange();
    },
    moveFirst: (q: number, r: number) => {
      const u = s.units.find((x) => x.owner === s.player);
      if (u) moveUnit(s, u.id, q, r);
      afterChange();
    },
    reachable: (unitId: number) => {
      const u = s.units.find((x) => x.id === unitId);
      return u ? reachableTiles(s, u).map((t) => ({ q: t.q, r: t.r, cost: t.cost })) : [];
    },
    screenPos: (q: number, r: number) => scene.screenPos(q, r),
    shipRoute: (q: number, r: number) => scene.shipRoute(q, r),
    shipPos: (id: number) => scene.shipPos(id),
    pickAtScreen: (x: number, y: number) => scene.pickAtScreen(x, y),
    hexDist: (q1: number, r1: number, q2: number, r2: number) => hexDist(q1, r1, q2, r2),
    selectTile: (q: number, r: number) => selectTile(q, r),
    selectNoMove: (q: number, r: number) => {
      const unit = s.units.find((x) => x.q === q && x.r === r);
      sel = unit ? { q, r, unitId: unit.id } : { q, r, unitId: null };
      afterChange();
    },
    get selection() {
      return sel;
    },
    buildDock: () => {
      const t = s.towns.find((x) => x.owner === s.player);
      if (t) buildImprovement(s, s.player, t.id, 'dock');
      afterChange();
    },
    train: (townId: number, kind: UnitKind) => {
      const err = trainUnit(s, s.player, townId, kind);
      afterChange();
      return err;
    },
    ship: (townId: number, qty: Record<string, number>) => {
      const amounts: Partial<Record<GoodId, number>> = {};
      for (const g of GOODS) {
        const n = qty[g.id] ?? 0;
        if (n > 0) amounts[g.id] = n;
      }
      const err = sendShip(s, townId, amounts);
      afterChange();
      return err;
    },
    payFine: (townId: number) => {
      const err = payFine(s, townId);
      if (err) flash(err);
      afterChange();
      return err;
    },
    endTurn: () => {
      endTurn(s);
      afterChange();
    },
    resolveEvent: (idx = 0) => {
      const e = s.pendingEvents[0];
      if (e) eventChoice(s, e.id, idx);
      afterChange();
      return !!e;
    },
  };
}

const app = document.getElementById('app')!;
const stageEl = document.createElement('div');
stageEl.id = 'stage';
app.appendChild(stageEl);

s = createGame(URL_SEED);
scene.init(stage(), s);
ui.setState(s);
ui.showIntroCard(s);
requestAnimationFrame(loop);
