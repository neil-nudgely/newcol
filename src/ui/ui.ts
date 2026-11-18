import { GOODS, IMPROVEMENTS, SETTLER_COST, SHIP_CARGO_CAP, STORAGE_CAP, TRAIN_COST, SALES_CAP, SALES_CAP_CUSTOM, militiaCostFor } from '../sim/goods';
import { getSettings } from '../settings';
import { encodeCode } from '../replay';
import { TECHS } from '../sim/techs';
import { jobWorkers, jobSlots,
  avgLoyalty, canDeclare, canDeclareFaith, canDeclareWealth, faithReady, hasRoad, ROAD_COST, ROAD_TURNS,
  FAITH_TARGET, WEALTH_TARGET, CHARTER_COST, improvementEraFor, nearestOwnDock, wagonTollPct, frigateCost, fortCost,
  effectiveDuty, mBuy,
} from '../sim/sim';
import { FOUNDERS } from '../sim/founders';
import { isCoastal, isWaterfront } from '../sim/state';
import { ERA_NAMES, ERA_II_YEAR, ERA_III_YEAR, EMPIRE_NAMES, EMPIRE_TRAITS, crownDutyFor, SEASONS } from '../sim/goods';
import type { DeclareKind, Owner, Tribe } from '../sim/types';
import { hasSave } from '../sim/state';
import { tileAt, townAt, isSettleable } from '../sim/state';
import { hexDist } from '../sim/hex';
import type { GameState, GoodId, ImprovementId, Tile, Town, Unit, UnitKind } from '../sim/types';

export type Selected = { q: number; r: number; unitId?: number } | null;

const OWNER_HEX: Record<Owner, string> = {
  england: '#b5432c', france: '#3b5ba5', spain: '#c9a227', netherlands: '#c97b2c',
  sweden: '#5a8f3c', portugal: '#8a4fa3', denmark: '#b83a3a', prussia: '#cfc063', russia: '#8a2a2a',
};

interface Callbacks {
  onEndTurn: () => void;
  onFoundTown: (unitId: number) => void;
  onUnitWait: (unitId: number) => void;
  onUnitView: (unitId: number) => void;
  onBombard: (frigateId: number, townId: number) => void;
  onSendShip: (townId: number) => void;
  onSendWagons: (townId: number) => void;
  onPayFine: (townId: number) => void;
  onTrain: (townId: number, kind: UnitKind) => void;
  onBuild: (townId: number, imp: ImprovementId) => void;
  onGift: (tribeIdx: number) => void;
  onTrade: (tribeIdx: number) => void;
  onSellToTribe: (tribeIdx: number, good: GoodId) => void;
  onBuyEurope: (townId: number, good: GoodId) => void;
  onEventChoice: (eventId: number, idx: number) => void;
  onNewGame: () => void;
  onDeclare: (kind: DeclareKind) => void;
  onBuyTech: (id: string) => void;
  onBuyFounder: (id: string) => void;
  onFulfillDemand: (tribeIdx: number) => void;
  onBuyLand: (townId: number) => void;
  onRoad: (fromId: number, toId: number) => void;
  onSetting: (key: 'fog' | 'sound' | 'music', value: boolean) => void;
  onAdoptCode: (code: string) => void;
  onResumeTrade: () => void;
  onSave: () => void;
  onLoad: () => void;
  onBegin: (seed: number, player: Owner, rivalCount: number, coop: boolean) => void;
}

const TEMPLATE = `
<div id="hud">
  <div class="hud-left">
    <span class="brand">NEWCOL <span id="brand-empire" class="brand-empire"></span></span>
    <span class="hud-stat" id="stat-year" data-era=""></span>
    <span class="hud-stat" id="stat-money"></span>
    <span class="hud-stat" id="stat-settlers"></span>
    <span class="hud-stat" id="stat-loyalty"></span>
    <span class="hud-stat" id="stat-warning"></span>
  </div>
  <div class="hud-right">
    <span id="causes-wrap" class="causes-wrap hidden">
      <button id="btn-causes" class="btn btn-danger">⚑ <span id="causes-badge"></span></button>
      <div id="causes-menu" class="causes-menu hidden"></div>
    </span>
    <button id="btn-save" class="btn btn-ghost">Save</button>
    <button id="btn-load" class="btn btn-ghost hidden">Load</button>
    <button id="btn-research" class="btn btn-ghost">Research</button>
    <button id="btn-settings" class="btn btn-ghost" aria-label="Settings">⚙</button>
    <button id="btn-diplo" class="btn btn-ghost">Diplomacy</button>
    <button id="btn-newgame" class="btn btn-ghost">New Game</button>
    <button id="btn-endturn" class="btn btn-primary">End Turn</button>
  </div>
</div>
<div id="context" class="hidden">
  <div class="ctx-card"><div id="ctx-body"></div></div>
</div>
<div id="logfeed" class="hidden"><div class="ctx-card"><div id="log-body"></div></div></div>
<div id="hint" class="hidden"><div class="hint-card" id="hint-card"></div></div>
<div id="modal" class="hidden"><div class="modal-card" id="modal-card"></div></div>
<div id="victory" class="hidden"><div class="modal-card victory-card" id="victory-card"></div></div>
<div id="intro" class="hidden"><div class="intro-card" id="intro-card"></div></div>
`;

function stanceLabel(v: number): string {
  if (v < -40) return 'hostile';
  if (v < -10) return 'wary';
  if (v <= 30) return 'neutral';
  return 'friendly';
}

function loyaltyColor(v: number): string {
  if (v >= 65) return '#4e94ad';
  if (v >= 45) return '#d9a441';
  return '#c0563b';
}

export const ui = {
  cb: {} as Callbacks,
  showIntro: true,
  diploOpen: false,
  researchOpen: false,
  settingsOpen: false,
  selected: null as Selected,
  container: null as HTMLDivElement | null,

  init(cb: Callbacks) {
    this.cb = cb;
    const host = document.getElementById('app')!;
    const wrap = document.createElement('div');
    wrap.id = 'ui';
    wrap.innerHTML = TEMPLATE;
    host.appendChild(wrap);
    this.container = wrap;
    this.$('#btn-endturn').addEventListener('click', () => this.cb.onEndTurn());
    this.$('#btn-research').addEventListener('click', () => {
      this.researchOpen = !this.researchOpen;
      this.diploOpen = false;
      this.settingsOpen = false;
      this.refresh();
    });
    this.$('#btn-diplo').addEventListener('click', () => {
      this.diploOpen = !this.diploOpen;
      this.researchOpen = false;
      this.settingsOpen = false;
      this.refresh();
    });
    this.$('#btn-settings').addEventListener('click', () => {
      this.settingsOpen = !this.settingsOpen;
      this.researchOpen = false;
      this.diploOpen = false;
      this.refresh();
    });
    this.$('#btn-newgame').addEventListener('click', () => this.cb.onNewGame());
    this.$('#btn-causes').addEventListener('click', (e) => {
      e.stopPropagation();
      this.$('#causes-menu').classList.toggle('hidden');
    });
    document.addEventListener('click', () => this.$('#causes-menu').classList.add('hidden'));
    this.$('#btn-save').addEventListener('click', () => this.cb.onSave());
    this.$('#btn-load').addEventListener('click', () => this.cb.onLoad());
  },

  $(sel: string): HTMLElement {
    return this.container!.querySelector(sel) as HTMLElement;
  },

  showIntroCard(s: GameState) {
    this.showIntro = true;
    this.$('#intro').classList.remove('hidden');
    const empires = (Object.keys(EMPIRE_NAMES) as Owner[]).map((e) =>
      `<div class="empire-opt" data-empire="${e}">
        <div class="empire-name">${EMPIRE_NAMES[e]}</div>
        <div class="empire-trait">${EMPIRE_TRAITS[e]}</div>
      </div>`).join('');
    this.$('#intro-card').innerHTML = `
      <h1 class="intro-title">NEWCOL</h1>
      <h2 class="intro-sub">Choose your crown, ${s.year}</h2>
      <p class="intro-body">
        The powers of Europe send ships across the water, each with its own charter, its own
        people, and its own way of getting rich. Choose who you are. Your crown takes its cut
        of everything that leaves your shores — and rival crowns are colonising the land beside you.
      </p>
      <div class="empire-grid">${empires}</div>
      <div class="rival-row">
        <span class="rival-label">Rival crowns on the board</span>
        <div class="rival-opts">
          ${[1, 2, 3].map((n) => `<button class="rival-opt${n === 1 ? ' chosen' : ''}" data-rivals="${n}">${n === 1 ? 'One' : n === 2 ? 'Two' : 'Three'}</button>`).join('')}
        </div>
      </div>
      <p class="intro-note">
        This is a game about a real place and real peoples. The nations you meet here — Powhatan,
        Iroquois, Algonquin, Huron, Timucua, Calusa, Lenape, Mohican, Susquehannock, Nanticoke —
        were here first. Disease, displacement, and violence are part of that history;
        this game shows them rather than hiding them.
      </p>
      <div class="intro-seed">
        <label for="seed">World seed <input id="seed" type="text" value="${s.seed}" /></label>
        <label class="set-row" title="Two governors, one keyboard: rival crowns you pick play by hand, passing the map each season. The Crown's machinery still aims at the first colony.">
          <input id="hotseat" type="checkbox" /> Second governor (hotseat)
        </label>
        <button id="btn-begin" class="btn btn-primary">Begin</button>
        ${hasSave() ? '<button id="btn-load-intro" class="btn">Load saved colony</button>' : ''}
      </div>`;
    let chosen: Owner = 'england';
    let rivalCount = 1;
    const opts = this.$('#intro-card').querySelectorAll<HTMLElement>('.empire-opt');
    opts.forEach((o) => {
      o.classList.add('empire-pick');
      o.addEventListener('click', () => {
        opts.forEach((x) => x.classList.remove('chosen'));
        o.classList.add('chosen');
        chosen = o.dataset.empire as Owner;
      });
    });
    opts.forEach((o) => {
      if ((o.dataset.empire as Owner) === 'england') o.classList.add('chosen');
    });
    this.$('#intro-card').querySelectorAll<HTMLElement>('.rival-opt').forEach((o) => {
      o.addEventListener('click', () => {
        this.$('#intro-card').querySelectorAll<HTMLElement>('.rival-opt').forEach((x) => x.classList.remove('chosen'));
        o.classList.add('chosen');
        rivalCount = Number(o.dataset.rivals);
      });
    });
    this.$('#btn-begin').addEventListener('click', () => {
      const v = (this.$('#seed') as HTMLInputElement).value.trim();
      const coop = (this.$('#hotseat') as HTMLInputElement)?.checked ?? false;
      this.cb.onBegin(v === '' ? s.seed : Number(v) || s.seed, chosen, rivalCount, coop);
    });
    const loadIntro = this.$('#btn-load-intro');
    if (loadIntro) {
      loadIntro.addEventListener('click', () => this.cb.onLoad());
    }
  },

  refresh() {
    if (!this.container) return;
    this.$('#intro').classList.toggle('hidden', !this.showIntro);
    if (this.showIntro) return;
    const s = this._s!;
    const canEnd = s.pendingEvents.length === 0 && !s.victory;
    (this.$('#btn-endturn') as HTMLButtonElement).disabled = !canEnd;
    // The three causes live in one dropdown so the nav bar never has to grow.
    const faith = faithReady(s);
    const anyFaith = s.towns.some((t) => t.owner === s.player && t.faith > 0);
    const anyExports = s.exportValBy[s.player] > 0;
    const warOn = s.warActive;
    const causes = [
      { kind: 'independence' as const, label: 'Declare Independence', ready: canDeclare(s), show: !warOn && (canDeclare(s) || avgLoyalty(s) < 55), status: `Loyalty ${avgLoyalty(s)} — every town at 40 or less, 3 towns` },
      { kind: 'faith' as const, label: 'City upon a Hill', ready: canDeclareFaith(s), show: !s.victory && anyFaith, status: `${faith}/3 towns at faith ${FAITH_TARGET}` },
      { kind: 'wealth' as const, label: 'Sign the Ledger', ready: canDeclareWealth(s), show: !s.victory && anyExports, status: `£${Math.round(s.exportValBy[s.player])} of £${WEALTH_TARGET} exported` },
    ].filter((c) => c.show);
    const ready = causes.filter((c) => c.ready).length;
    this.$('#causes-wrap').classList.toggle('hidden', causes.length === 0);
    this.$('#causes-badge').textContent = ready > 0 ? `${ready} ready` : 'Causes';
    const menu = this.$('#causes-menu');
    menu.innerHTML = causes.map((c) => `
      <button class="cause-row" data-cause="${c.kind}" ${c.ready ? '' : 'disabled'}>
        <span class="cause-label">${c.ready ? '⚑ ' : ''}${c.label}</span>
        <span class="cause-status">${warOn && c.kind === 'independence' ? 'at war' : c.status}</span>
      </button>`).join('');
    menu.querySelectorAll<HTMLButtonElement>('[data-cause]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.add('hidden');
        this.cb.onDeclare(b.dataset.cause as 'independence' | 'faith' | 'wealth');
      });
    });

    this.$('#btn-load').classList.toggle('hidden', !hasSave());
    this.renderHud(s);
    this.renderContext(s);
    this.renderLog(s);
    this.renderHint(s);
    this.renderModal(s);
    this.renderVictory(s);
  },

  renderHint(s: GameState) {
    const hint = this.$('#hint');
    const show = !s.victory && s.towns.every((t) => t.owner !== s.player);
    hint.classList.toggle('hidden', !show);
    if (show) {
      this.$('#hint-card').innerHTML = `
        <strong>Begin the settlement.</strong>
        Your settlers stand ashore by the mother country's ships. Click a settler to select it (the gold pointer
        marks it), then click a highlighted tile to march there — 1 tile costs 1 move, up to 3 a turn.
        Found your first town on the tile a settler stands on: it takes that settler and £${CHARTER_COST}.
        <span class="ctx-dim">Drag to orbit · scroll to zoom · right-drag to pan · click a tile with several settlers to switch between them</span>`;
    }
  },

  _s: null as GameState | null,
  setState(s: GameState) {
    this._s = s;
  },

  renderHud(s: GameState) {
    const income = Math.round(s.income[s.player]);
    const settlers = s.units.filter((u) => u.owner === s.player && u.kind === 'settler').length;
    const arms = s.units.filter((u) => u.owner === s.player && (u.kind === 'militia' || u.kind === 'soldier' || u.kind === 'ranger')).length;
    const frigates = s.units.filter((u) => u.owner === s.player && u.kind === 'frigate').length;
    const atSea = s.ships.filter((sh) => sh.owner === s.player);
    const pending = atSea.reduce((a, sh) => a + sh.value * (1 - crownDutyFor(s.player)), 0);
    const yearEl = this.$('#stat-year');
    yearEl.textContent = `${s.year} · ${SEASONS[s.season]}`;
    (yearEl as HTMLElement).dataset.era = ERA_NAMES[s.era];
    (this.$('#brand-empire') as HTMLElement).textContent = EMPIRE_NAMES[s.player];
    this.$('#stat-money').innerHTML =
      `£${Math.round(s.treasury[s.player])} <span class="dim">(+${income})</span>` +
      (atSea.length > 0 ? ` <span class="dim" title="${atSea.length} ship${atSea.length > 1 ? 's' : ''} at sea">· ⛵${atSea.length} £${Math.round(pending)} due</span>` : '');
    (this.$('#btn-research') as HTMLButtonElement).innerHTML = `✦${Math.floor(s.insight[s.player] ?? 0)} <span class=\"dim\">· Learning ${(s.researched[s.player] ?? []).length + (s.founders[s.player] ?? []).length}/${TECHS.length + FOUNDERS.length}</span>`;
    (this.$('#stat-settlers') as HTMLElement).innerHTML =
      `⚑ ${settlers}${arms > 0 ? ` · ⚔ ${arms}` : ''}${frigates > 0 ? ` · ⛵ ${frigates} frigate${frigates > 1 ? 's' : ''}` : ''}`;
    const loy = avgLoyalty(s);
    this.$('#stat-loyalty').innerHTML =
      `Loyalty <span style="color:${loyaltyColor(loy)}">${loy}</span>`;
    const warning = document.getElementById('stat-warning');
    if (warning) {
      let text = '';
      let danger = false;
      if (s.garrison) {
        const t = s.towns.find((x) => x.id === s.garrison!.targetTownId);
        text = `⚔ Royal troops for ${t ? t.name : 'a town'}: ${s.garrison.arriveIn} turn${s.garrison.arriveIn === 1 ? '' : 's'}`;
        danger = true;
      } else if (s.occupations.length > 0) {
        const t = s.towns.find((x) => x.id === s.occupations[0].townId);
        text = `⚜ ${s.occupations.length} town${s.occupations.length > 1 ? 's' : ''} occupied${t ? ` (${t.name})` : ''}`;
        danger = true;
      } else if (s.warActive) {
        text = `⚔ WAR FOR INDEPENDENCE — season ${s.warTurns}/48 · expedition ${s.wavesFired} of the King's`;
        danger = true;
      } else if (s.tradeSevered) {
        text = `⚓ Ports sealed to the mother country — the trade stands cut`;
        danger = true;
      } else if (s.taxRate > 10 || s.taxesPaid > 0) {
        text = `⚜ King’s duty ${s.taxRate}% · £${Math.round(s.taxesPaid)} paid into his regiments`;
        danger = s.taxRate >= 40;
      }
      warning.textContent = text;
      warning.style.color = danger ? '#e08a58' : 'var(--dim)';
      warning.style.display = text ? '' : 'none';
    }
  },

  shipQty: {} as Record<number, Partial<Record<GoodId, number>>>,
  qty(townId: number, good: GoodId): number {
    const t = this._s?.towns.find((x) => x.id === townId);
    const max = t ? t.stock[good] : 0;
    return Math.min(this.shipQty[townId]?.[good] ?? 0, max);
  },
  setQty(townId: number, good: GoodId, n: number): void {
    (this.shipQty[townId] ??= {})[good] = n;
  },
  clearQty(townId: number): void {
    delete this.shipQty[townId];
  },
  shipTotal(townId: number): number {
    const row = this.shipQty[townId];
    if (!row) return 0;
    return GOODS.reduce((a, g) => a + (row[g.id] ?? 0), 0);
  },

  renderContext(s: GameState) {
    const ctx = this.$('#context');
    const sel = this.selected;
    if (!sel) {
      ctx.classList.add('hidden');
      return;
    }
    ctx.classList.remove('hidden');
    const body = this.$('#ctx-body');

    const unit = sel.unitId != null ? s.units.find((u) => u.id === sel.unitId) : undefined;
    if (unit) {
      body.innerHTML = this.unitHtml(s, unit);
      const found = this.$('#btn-found');
      if (found) {
        found.addEventListener('click', () => this.cb.onFoundTown(unit.id));
      }
      const wait = this.$('#btn-wait');
      if (wait) {
        wait.addEventListener('click', () => this.cb.onUnitWait(unit.id));
      }
      const view = this.$('#btn-viewtown') ?? this.$('#btn-viewtile');
      if (view) {
        view.addEventListener('click', () => this.cb.onUnitView(unit.id));
      }
      body.querySelectorAll<HTMLButtonElement>('[data-bombard]').forEach((b) => {
        b.addEventListener('click', () => this.cb.onBombard(unit.id, Number(b.dataset.bombard)));
      });
      return;
    }

    const tile = tileAt(s, sel.q, sel.r);
    if (!tile) {
      body.innerHTML = '';
      return;
    }
    const town = townAt(s, sel.q, sel.r);
    if (town) {
      const occupied = s.occupations.some((o) => o.townId === town.id);
      body.innerHTML = this.townHtml(s, town, occupied);
      if (town.owner === s.player) {
        const resumeBtn = body.querySelector('[data-resume]');
        if (resumeBtn) resumeBtn.addEventListener('click', () => this.cb.onResumeTrade());
        body.querySelectorAll<HTMLButtonElement>('[data-buyland]').forEach((b) => {
          b.addEventListener('click', () => {
            this.cb.onBuyLand(Number(b.dataset.buyland));
          });
        });
        body.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach((b) => {
          b.addEventListener('click', () => {
            this.cb.onBuyEurope(town.id, b.dataset.buy as GoodId);
          });
        });
        body.querySelectorAll<HTMLButtonElement>('[data-build]').forEach((b) => {
          b.addEventListener('click', () => {
            this.cb.onBuild(town.id, b.dataset.build as ImprovementId);
          });
        });
        body.querySelectorAll<HTMLButtonElement>('[data-train]').forEach((b) => {
          b.addEventListener('click', () => {
            this.cb.onTrain(town.id, b.dataset.train as UnitKind);
          });
        });
        body.querySelector<HTMLButtonElement>('#btn-road')?.addEventListener('click', () => {
          const sel = body.querySelector<HTMLSelectElement>('#road-target');
          if (sel) this.cb.onRoad(town.id, Number(sel.value));
        });
        body.querySelectorAll<HTMLButtonElement>('[data-qty]').forEach((b) => {
          b.addEventListener('click', () => {
            const good = b.dataset.qty as GoodId;
            const d = b.dataset.d;
            const cur = this.qty(town.id, good);
            const others = this.shipTotal(town.id) - cur;
            const room = SHIP_CARGO_CAP - others;
            const next = d === 'all'
              ? Math.min(town.stock[good], room)
              : d === 'clear'
                ? 0
                : Math.min(cur + Number(d), town.stock[good], room);
            this.setQty(town.id, good, Math.max(0, next));
            this.refresh();
          });
        });
        const send = this.$('#btn-send');
        if (send) {
          send.addEventListener('click', () => {
            if (town.improvements.includes('dock')) this.cb.onSendShip(town.id);
            else this.cb.onSendWagons(town.id);
          });
        }
        const fine = this.$('[data-fine]');
        if (fine) {
          fine.addEventListener('click', () => this.cb.onPayFine(town.id));
        }
      }
      return;
    }
    const exploredIdx = sel.r * s.mapW + sel.q;
    if (getSettings().fog && !s.explored[exploredIdx]) {
      body.innerHTML = `
        <div class="ctx-title">Uncharted</div>
        <div class="ctx-dim">This ground is beyond your sight. March a settler or soldier here — or chart it from the sea — to learn what lies in wait.</div>
        <div class="ctx-hint">Drag to orbit · scroll to zoom · right-drag to pan</div>`;
      return;
    }
    // Tribal claims are only mentioned while the tile is actually in sight (fog of war).
    const inClaim = s.visible[exploredIdx]
      ? s.tribes
          .filter((tr) => hexDist(sel.q, sel.r, tr.q, tr.r) <= tr.claimRadius)
          .map((tr) => tr.name)
      : [];
    body.innerHTML = `
      <div class="ctx-title">${terrainName(tile.terrain)}</div>
      <div class="ctx-dim">${terrainDesc(tile.terrain)}</div>
      ${inClaim.length ? `<div class="ctx-warn">${inClaim.join(' and ')} land — settlement here will anger them.</div>` : ''}
      ${isSettleable(tile.terrain)
        ? `<div class="ctx-dim">March one of your settlers onto this tile to found a town here.</div>`
        : ''}
      <div class="ctx-hint">Drag to orbit · scroll to zoom · right-drag to pan</div>`;
  },

  unitHtml(s: GameState, u: Unit): string {
    const tile = tileAt(s, u.q, u.r);
    const town = townAt(s, u.q, u.r);
    const stack = s.units.filter((x) => x.q === u.q && x.r === u.r);
    const stackIdx = stack.findIndex((x) => x.id === u.id);
    const stackNote = stack.length > 1 ? ` <span class="dim">(${stackIdx + 1} of ${stack.length} here)</span>` : '';
    const settleable = tile ? isSettleable(tile.terrain) : false;
    const tooClose = s.towns.some((t) => hexDist(t.q, t.r, u.q, u.r) <= 1);
    const canFound =
      u.owner === s.player &&
      settleable &&
      !town &&
      !tooClose &&
      s.treasury[s.player] >= CHARTER_COST &&
      !s.victory;
    const reason = tile?.terrain === 'coast'
      ? 'The sand here is too soft to build on. March to grass or forest.'
      : !settleable
        ? 'The ground here will not hold a town — you need grass or forest.'
        : town
          ? `This settler is standing in ${town.name}. To found a new town, march them to open ground at least 2 tiles from any town${u.moveLeft === 0 ? ' — end the turn first so they can move' : ''}.`
          : tooClose
            ? 'Too close to an existing town — a new town needs 2 clear tiles of space. March the settler farther out.'
            : s.treasury[s.player] < CHARTER_COST
              ? `A charter costs £${CHARTER_COST}. Not enough money yet.`
              : '';
    const isSettler = u.kind === 'settler';
    const isFrigate = u.kind === 'frigate';
    const KIND_TITLE: Record<UnitKind, string> = { settler: 'Settler', militia: 'Militiaman', soldier: 'Line Soldier', ranger: 'Ranger', frigate: 'Frigate' };
    const title = KIND_TITLE[u.kind];
    const onWater = tile ? tile.terrain === 'ocean' || tile.terrain === 'coast' : false;
    const friendlyDocks = s.towns.filter((t) => t.owner === u.owner && t.improvements.includes('dock') && hexDist(t.q, t.r, u.q, u.r) <= 1);
    const enemyFrigates = s.units.filter((x) => x.kind === 'frigate' && x.owner !== u.owner);
    const threatenedDocks = s.towns.filter(
      (t) => t.owner === u.owner && t.improvements.includes('dock') && !friendlyDocks.includes(t)
        && enemyFrigates.some((f) => hexDist(f.q, f.r, t.q, t.r) <= 2),
    );
    const bombTargets = s.towns.filter((t) => t.owner !== u.owner && hexDist(t.q, t.r, u.q, u.r) <= 2);
    const frigateSection = u.owner === s.player ? `
      <div class="ctx-dim">A warship, not a cargo vessel — she carries no goods. Her jobs: <b>shadow</b> your docks (full value, safe from interception) and <b>bombard</b> enemy ports. To export, open a <b>dock town</b> and use its <i>Send Ship</i>.</div>
      ${!onWater
        ? `<div class="ctx-warn">She is still on the quay at ${town ? town.name : 'the shore'} — click a highlighted water tile to put to sea. Click the quay again to bring her home.</div>`
        : ''}
      ${friendlyDocks.map((t) =>
        `<div class="ctx-dim">Shadowing the ${t.name} dock: its cargo sails at full value, and no enemy frigate can cut it off.</div>`).join('')}
      ${threatenedDocks.map((t) =>
        `<div class="ctx-warn">An enemy frigate lurks within gun range of the ${t.name} dock — its cargo will be cut off unless you shadow it.</div>`).join('')}
      ${bombTargets.length > 0 ? `<div class="train-row">${bombTargets.map((t) =>
        `<button data-bombard="${t.id}" class="btn btn-small" ${u.bombardedThisTurn ? 'disabled' : ''}>Bombard ${t.name}${t.improvements.includes('fort') ? ' (fortified: reduced damage)' : ''}</button>`).join('')}</div>` : ''}
      ${u.bombardedThisTurn ? `<div class="ctx-dim">The guns are cooling — she has already loosed them this turn.</div>` : ''}
    ` : `<div class="ctx-dim">A French frigate. Her guns keep your sloops honest — and her shadow keeps her own cargo safe.</div>`;
    return `
      <div class="ctx-title">${title}${stackNote} <span class="owner-badge owner-${u.owner}">${EMPIRE_NAMES[u.owner]}</span></div>
      <div class="ctx-stats">
        <span>Moves left: ${u.moveLeft}</span>
      </div>
      <div class="ctx-dim">Standing on ${town ? `the town of ${town.name}` : terrainName(tile?.terrain ?? 'ocean').toLowerCase()}.</div>
      ${u.owner === s.player
        ? isFrigate
          ? frigateSection
          : isSettler
            ? canFound
              ? `<button id="btn-found" class="btn btn-primary">Found a Town here (£${CHARTER_COST})</button>`
              : `<div class="ctx-dim">${reason}</div>`
            : `<div class="ctx-dim">A ${u.kind === 'ranger' ? 'ranger watches from the tree line' : u.kind === 'soldier' ? 'line soldier stands at the palisade' : 'militiaman guards the town where he camps'} — raids are turned back${(u.veterans ?? 0) > 0 ? `, hardened by ${(u.veterans ?? 0)} victory${(u.veterans ?? 0) > 1 ? 'ies' : ''}` : ''}. Only settlers can found towns.</div>`
        : `<div class="ctx-dim">${EMPIRE_NAMES[u.owner]} ${KIND_TITLE[u.kind].toLowerCase()}. They are not your people.</div>`}
      ${u.owner === s.player
        ? `<div class="train-row">
             <button id="btn-wait" class="btn btn-small" ${u.moveLeft === 0 ? 'disabled' : ''}>Wait (hold position)</button>
             ${town
               ? `<button id="btn-viewtown" class="btn btn-small">Open ${town.name}</button>`
               : `<button id="btn-viewtile" class="btn btn-small">View this tile</button>`}
           </div>`
        : ''}
      ${u.owner === s.player && u.moveLeft > 0
        ? `<div class="ctx-hint">${isFrigate
            ? 'Click a highlighted tile to sail there — the frigate moves 4 tiles of water a turn and cannot run aground.'
            : `Click a highlighted tile to march there — 1 tile costs 1 move, hills cost 2, up to ${u.moveLeft} this turn.${stack.length > 1 ? ' Click this tile again to switch to the next man here.' : ''}`}</div>`
        : u.owner === s.player && u.moveLeft === 0
          ? `<div class="ctx-hint">Holding position — end the turn to rest.</div>`
          : ''}
    `;
  },

  townHtml(s: GameState, t: Town, occupied: boolean): string {
    const isEng = t.owner === s.player;
    const hasDock = t.improvements.includes('dock');
    const hasWagon = t.improvements.includes('wagondepot');
    const waterfront = isWaterfront(s, t.q, t.r);
    const newSettlement = t.foundedThisTurn;
    const occNote = occupied
      ? `<div class="occ-banner">UNDER ROYAL GUARD
          <div class="ctx-dim">No production, building, training, or shipping. The people thin under the guard; their loyalty to the Crown grows in the shadow of the bayonets.</div>
          ${isEng ? `<button data-fine class="btn btn-small">Pay the £100 fine and end the occupation</button>` : ''}
        </div>`
      : '';
    const stockRows = GOODS.filter((g) => g.era <= s.era).map((g) => {
      const price = s.prices[g.id];
      const prev = s.prevPrices[g.id];
      const arrow = price > prev ? '▲' : price < prev ? '▼' : '·';
      const cls = price > prev ? 'up' : price < prev ? 'down' : 'dim';
      const qty = this.qty(t.id, g.id);
      const others = this.shipTotal(t.id) - qty;
      const room = SHIP_CARGO_CAP - others;
      const stepper = isEng && (hasDock || hasWagon) ? `
        <span class="stepper">
          <button data-qty="${g.id}" data-d="-1" class="btn btn-tiny" ${qty <= 0 ? 'disabled' : ''}>−</button>
          <b class="stepper-n">${qty}</b>
          <button data-qty="${g.id}" data-d="1" class="btn btn-tiny" ${qty >= t.stock[g.id] || room <= 0 ? 'disabled' : ''}>＋</button>
          <button data-qty="${g.id}" data-d="all" class="btn btn-tiny" ${t.stock[g.id] === 0 || room <= 0 ? 'disabled' : ''}>all</button>
        </span>` : '';
      return `<div class="stock-row">
        <span>${g.name}</span>
        <span class="stock-num" title="A storehouse holds ${STORAGE_CAP} of each good; surplus spoils">${t.stock[g.id]}${t.stock[g.id] >= STORAGE_CAP ? ' <span class="dim">full</span>' : ''}</span>
        <span class="${cls}">£${price} ${arrow}</span>
        ${stepper}
      </div>`;
    }).join('');
    let tradeSection = '';
    if (isEng && (hasDock || hasWagon)) {
      let gross = 0;
      for (const g of GOODS) gross += this.qty(t.id, g.id) * s.prices[g.id];
      const loaded = this.shipTotal(t.id);
      if (hasDock) {
        const custom = t.improvements.includes('customhouse');
        const quota = SALES_CAP + (custom ? SALES_CAP_CUSTOM : 0);
        const sold = t.seasonGross ?? 0;
        const overQuota = gross > quota - sold;
        tradeSection = `
        <div class="ctx-sub">Load a ship for Europe</div>
        <div class="ctx-dim">A sloop carries ${SHIP_CARGO_CAP} goods. The voyage takes 1 turn; the Crown takes ${Math.round(crownDutyFor(s.player) * 100)}% on arrival. The market remembers: Europe buys only so much a year — glut it and prices stay down. A dock loads one ship per turn.</div>
        <div class="ctx-dim">This town's season: £${sold} of £${quota} landed${custom ? ' (Custom House)' : ' — a Custom House would lift the quota'}.</div>
        <button id="btn-send" class="btn btn-primary" ${loaded <= 0 || t.shippedThisTurn || overQuota ? 'disabled' : ''}>
          ${t.shippedThisTurn
            ? `Ship away — the dock rests until next turn (${loaded}/${SHIP_CARGO_CAP} still to load)`
            : overQuota && loaded > 0
              ? `Over the season's quota — unload some (£${Math.round(gross)} vs £${quota - sold} left)`
              : `Send Ship (${loaded}/${SHIP_CARGO_CAP} loaded) — £${Math.round(gross)} gross, £${Math.round(gross * (1 - effectiveDuty(s, s.player)))} on arrival`}
        </button>`;
      } else {
        const port = nearestOwnDock(s, t);
        const laneToPort = !!port && hasRoad(s, t.id, port.id);
        const toll = laneToPort ? 0 : Math.max(1, Math.round(gross * wagonTollPct(s, s.player)));
        tradeSection = port
          ? `
        <div class="ctx-sub">Load a wagon train for ${port.name}</div>
        <div class="ctx-dim">This town is inland. Carts haul ${SHIP_CARGO_CAP} goods to your nearest port, which ships them on. ${laneToPort
          ? `Your own road runs to ${port.name} — <b>no toll</b>.`
          : `A ${Math.round(wagonTollPct(s, s.player) * 100)}% toll (£${toll}) is paid on every load; a road to the port would end it.`} One convoy per turn.</div>
        <button id="btn-send" class="btn btn-primary" ${loaded <= 0 || t.shippedThisTurn ? 'disabled' : ''}>
          ${t.shippedThisTurn
            ? `The wagons rest until next turn (${loaded}/${SHIP_CARGO_CAP} still loaded)`
            : `Send Wagons (${loaded}/${SHIP_CARGO_CAP})${toll > 0 ? ` — £${toll} toll to ${port.name}` : ` — toll-free to ${port.name}`}`}
        </button>`
          : `
        <div class="ctx-sub">Wagon Depot</div>
        <div class="ctx-warn">No port yet — build a dock on the coast or a river so inland goods can be shipped.</div>`;
      }
    }
    // Europe's imports: dock towns can buy what Europe makes.
    let buySection = '';
    if (isEng && hasDock) {
      const imports: GoodId[] = (['tradeGoods', 'tools', 'muskets'] as GoodId[]).filter((g) => GOODS.find((x) => x.id === g)!.era <= s.era);
      buySection = s.tradeSevered
        ? `
        <div class="ctx-sub">The Boycott</div>
        <div class="ctx-dim">Your ports stand sealed to the mother country by your own answer to the duty. £300 of arrears and a humble letter reopens them.</div>
        <button data-resume class="btn btn-small" ${s.treasury[s.player] < 300 ? 'disabled' : ''}>Resume trade (£300)</button>`
        : `
        <div class="ctx-sub">Buy in Europe</div>
        <div class="ctx-dim">Kettles and gun benches the colony cannot yet make. Goods ride home on the returning ship.</div>
        <div class="train-row">${imports.map((g) => {
          const name = GOODS.find((x) => x.id === g)!.name;
          const price = Math.round(5 * mBuy(s, s.player, g));
          return `<button data-buy="${g}" class="btn btn-small" ${s.treasury[s.player] < price ? 'disabled' : ''}>5 ${name} · £${price}</button>`;
        }).join('')}</div>`;
    }
    // Workshops: show what the town manufactures and what is waiting.
    let workshopSection = '';
    if (isEng) {
      const links = t.improvements.flatMap((imp) => (IMPROVEMENTS[imp].manufacture ?? []).map((l) => ({ imp, l })));
      if (links.length > 0) {
        workshopSection = `
        <div class="ctx-sub">Workshops</div>
        ${links.map(({ imp, l }) => {
          const ing = l.in.map(([g, n]) => `${n} ${GOODS.find((x) => x.id === g)!.name.toLowerCase()} (have ${t.stock[g]})`).join(' + ');
          return `<div class="ctx-dim">${IMPROVEMENTS[imp].name}: ${ing} → 1 ${GOODS.find((x) => x.id === l.out)!.name.toLowerCase()}, ${l.cap} a season${t.fed ? '' : ' — idle, the town is hungry'}.</div>`;
        }).join('')}`;
      }
    }
    let trainSection = '';
    if (isEng) {
      const busy = t.trainedThisTurn;
      const hungry = !t.fed;
      const trainNote = newSettlement
        ? 'The men are still raising the settlement — building and training start next turn.'
        : hungry
          ? 'The town is hungry — no one can be spared from the fields.'
          : busy
            ? 'They have already trained someone this turn.'
            : '';
      trainSection = `
        <div class="ctx-sub">Training</div>
        <div class="train-row">
          <button data-train="settler" class="btn btn-small" ${newSettlement || busy || hungry || s.treasury[s.player] < SETTLER_COST ? 'disabled' : ''}>Train Settler £${SETTLER_COST}</button>
          <button data-train="militia" class="btn btn-small" ${newSettlement || busy || hungry || s.treasury[s.player] < militiaCostFor(s.player) ? 'disabled' : ''}>Train Militia £${militiaCostFor(s.player)}</button>
          <button data-train="soldier" class="btn btn-small" title="Needs 1 Musket in store" ${newSettlement || busy || hungry || t.stock.muskets < 1 || s.treasury[s.player] < TRAIN_COST.soldier ? 'disabled' : ''}>Soldier £${TRAIN_COST.soldier} + musket</button>
          <button data-train="ranger" class="btn btn-small" title="Needs 1 Musket in store; forest home only. Sees 5, moves the woods fast" ${newSettlement || busy || hungry || t.stock.muskets < 1 || s.treasury[s.player] < TRAIN_COST.ranger ? 'disabled' : ''}>Ranger £${TRAIN_COST.ranger} + musket</button>
          <button data-train="frigate" class="btn btn-small" ${newSettlement || busy || hungry || !hasDock || !isCoastal(s, t.q, t.r) || s.treasury[s.player] < frigateCost(s, s.player) ? 'disabled' : ''}>
            ${hasDock
              ? (isCoastal(s, t.q, t.r) ? `Build Frigate £${frigateCost(s, s.player)}` : 'Warships need the open sea — not a river mouth')
              : 'Frigate (needs a dock)'}
          </button>
        </div>
        ${trainNote ? `<div class="ctx-dim">${trainNote}</div>` : ''}`;
    }
    let roadSection = '';
    if (isEng) {
      const mine = s.roads.filter((r) => r.owner === s.player && (r.a === t.id || r.b === t.id));
      const works = s.roadWork.filter((w) => w.owner === s.player && (w.from === t.id || w.to === t.id));
      const nameOf = (id: number) => s.towns.find((x) => x.id === id)?.name ?? 'a lost town';
      const targets = s.towns.filter((x) => x.owner === s.player && x.id !== t.id
        && !hasRoad(s, t.id, x.id) && !s.roadWork.some((w) => (w.from === t.id && w.to === x.id) || (w.from === x.id && w.to === t.id)));
      const lines = [
        ...mine.map((r) => `<div class="ctx-dim">· A cleared lane to ${nameOf(r.a === t.id ? r.b : r.a)} — carts pass free, your people walk it easy.</div>`),
        ...works.map((w) => `<div class="ctx-dim">· Cutting a road to ${nameOf(w.from === t.id ? w.to : w.from)} — ${w.turnsLeft} season${w.turnsLeft > 1 ? 's' : ''} to go.</div>`),
      ].join('');
      const picker = targets.length > 0
        ? `<div class="train-row">
            <select id="road-target" class="btn btn-small">${targets.map((x) => `<option value="${x.id}">to ${x.name}</option>`).join('')}</select>
            <button id="btn-road" class="btn btn-small" ${s.treasury[s.player] < ROAD_COST || works.length > 0 ? 'disabled' : ''}>Cut Road £${ROAD_COST} · ${ROAD_TURNS} seasons</button>
          </div>`
        : '';
      if (lines || picker) roadSection = `<div class="ctx-sub">Roads</div>${lines}${picker}`;
    }
    const impRows = (Object.keys(IMPROVEMENTS) as ImprovementId[]).map((imp) => {
      const def = IMPROVEMENTS[imp];
      const built = t.improvements.includes(imp);
      const isBuilding = t.construction?.imp === imp;
      const eraReq = improvementEraFor(s, s.player, imp);
      const locked = eraReq > s.era;
      const unlockYear = eraReq === 2 ? ERA_II_YEAR : ERA_III_YEAR;
      const cost = imp === 'fort' ? fortCost(s, s.player) : def.cost;
      return `<div class="imp-row ${built ? 'built' : ''} ${locked ? 'locked' : ''}">
        <div class="imp-name">${def.name}${built ? ' ✓' : isBuilding ? ' — building' : locked ? ' — not yet' : ''}</div>
        <div class="ctx-dim imp-desc">${def.desc}</div>
        ${built ? '' : locked
          ? `<div class="ctx-dim">Unlocks in ${ERA_NAMES[eraReq]} (${unlockYear}).${imp === 'artillery' ? ' Master Fine Gunpowder to raise it sooner.' : ''}</div>`
          : isBuilding
            ? `<div class="ctx-dim">${t.construction!.turnsLeft} turn${t.construction!.turnsLeft > 1 ? 's' : ''} to go${t.fed ? '' : ' — halted, the town is hungry'}</div>`
            : isEng
              ? (imp === 'dock' && !waterfront
                ? `<div class="ctx-warn">Upcountry — a dock needs the sea or a river at the town's edge. Build a Wagon Depot to ship by land.</div>`
                : `<button data-build="${imp}" class="btn btn-small" ${s.treasury[s.player] < cost || t.construction || newSettlement ? 'disabled' : ''}>Build £${cost} · ${def.turns} turn${def.turns > 1 ? 's' : ''}</button>`)
              : ''}
      </div>`;
    }).join('');
    return `
      <div class="ctx-title">${t.name} <span class="owner-badge owner-${t.owner}">${EMPIRE_NAMES[t.owner as Owner]}</span></div>
      ${occNote}
      <div class="ctx-stats">
        <span>Population ${t.pop}</span>
        <span>Founded ${t.foundedYear}</span>
        ${isEng ? `<span style="color:${loyaltyColor(t.loyalty)}">Loyalty ${Math.round(t.loyalty)}</span>` : ''}
        ${t.faith > 0 ? `<span style="color:${t.faith >= FAITH_TARGET ? 'var(--up)' : '#c9a86a'}">Faith ${Math.round(t.faith)}</span>` : ''}
      </div>
      <div class="${t.fed ? 'ctx-dim' : 'ctx-warn'}">
        Fields: ${t.food} of ${Math.ceil(t.pop * 0.7)} food
        ${t.fed ? '' : ' — the town is hungry: it produces nothing and earns nothing'}
      </div>
      ${isEng ? (() => {
        const w = jobWorkers(s, t);
        const sl = jobSlots(s, t);
        const idle = t.pop - w.farmer - w.artisan - w.trader;
        const parts: string[] = [];
        if (w.farmer) parts.push(`${w.farmer} farmer${w.farmer > 1 ? 's' : ''} (+${(w.farmer * 0.5).toFixed(1)} food)`);
        if (w.artisan) parts.push(`${w.artisan} artisan${w.artisan > 1 ? 's' : ''} (+1 workshop output each)`);
        if (w.trader) parts.push(`${w.trader} trader${w.trader > 1 ? 's' : ''} (+${w.trader * 5}% on shiploads)`);
        parts.push(`${idle} at common labour`);
        const freeSlots = (sl.farmer - w.farmer) + (sl.artisan - w.artisan) + (sl.trader - w.trader);
        return `<div class="ctx-dim">Hands to work: ${parts.join(' · ')}${freeSlots > 0 ? ` — ${freeSlots} job${freeSlots > 1 ? 's' : ''} await${freeSlots > 1 ? '' : 's'} more people` : ''}.</div>`;
      })() : ''}
      ${isEng ? `<div class="loyalty-bar"><div class="loyalty-fill" style="width:${t.loyalty}%;background:${loyaltyColor(t.loyalty)}"></div></div>` : ''}
      ${(() => {
        if (!isEng) return '';
        const inClaim = s.tribes.find((tr) => hexDist(tr.q, tr.r, t.q, t.r) <= tr.claimRadius);
        if (!inClaim) return '';
        return t.landBought.includes(s.player)
          ? `<div class="ctx-dim">The deed to this land was bought and witnessed — the ${inClaim.name} remember.</div>`
          : `<div class="ctx-sub">The Land</div>
             <div class="ctx-dim">This ground is ${inClaim.name} country. A witnessed deed (£60) ends their resentment of the town.</div>
             <button data-buyland="${t.id}" class="btn btn-small" ${s.treasury[s.player] < 60 ? 'disabled' : ''}>Buy the deed (£60)</button>`;
      })()}
      <div class="ctx-sub">Stores</div>
      ${stockRows}
      ${workshopSection}
      ${tradeSection}
      ${buySection}
      ${trainSection}${roadSection}
      <div class="ctx-sub">Improvements</div>
      ${impRows}
    `;
  },

  renderLog(s: GameState) {
    const feed = this.$('#logfeed');
    feed.classList.toggle('hidden', s.log.length === 0);
    this.$('#log-body').innerHTML = s.log.slice(0, 7)
      .map((l) => `<div class="log-line">${l}</div>`)
      .join('');
  },

  renderModal(s: GameState) {
    const modal = this.$('#modal');
    const card = this.$('#modal-card');
    if (this.settingsOpen) {
      modal.classList.remove('hidden');
      card.innerHTML = this.settingsHtml(s);
      card.querySelectorAll<HTMLInputElement>('[data-setting]').forEach((cb) => {
        cb.addEventListener('change', () => this.cb.onSetting(cb.dataset.setting as 'fog' | 'sound' | 'music', cb.checked));
      });
      card.querySelector('#btn-copy-code')?.addEventListener('click', () => {
        const ta = card.querySelector<HTMLTextAreaElement>('#code-out');
        if (!ta) return;
        ta.select();
        void navigator.clipboard?.writeText(ta.value).catch(() => undefined);
      });
      card.querySelector('#btn-adopt-code')?.addEventListener('click', () => {
        const ta = card.querySelector<HTMLTextAreaElement>('#code-in');
        if (ta?.value.trim()) this.cb.onAdoptCode(ta.value.trim());
      });
      card.querySelector('[data-settings-close]')?.addEventListener('click', () => {
        this.settingsOpen = false;
        this.refresh();
      });
      return;
    }
    if (this.researchOpen) {
      modal.classList.remove('hidden');
      card.innerHTML = this.researchHtml(s);
      card.querySelectorAll<HTMLButtonElement>('[data-tech]').forEach((b) =>
        b.addEventListener('click', () => this.cb.onBuyTech(b.dataset.tech!)));
      card.querySelectorAll<HTMLButtonElement>('[data-founder]').forEach((b) =>
        b.addEventListener('click', () => this.cb.onBuyFounder(b.dataset.founder!)));
      this.$('[data-research-close]')?.addEventListener('click', () => {
        this.researchOpen = false;
        this.refresh();
      });
      return;
    }
    if (this.diploOpen) {
      modal.classList.remove('hidden');
      card.innerHTML = this.diploHtml(s);
      card.querySelectorAll<HTMLButtonElement>('[data-gift]').forEach((b) =>
        b.addEventListener('click', () => this.cb.onGift(Number(b.dataset.gift))));
      card.querySelectorAll<HTMLButtonElement>('[data-trade]').forEach((b) =>
        b.addEventListener('click', () => this.cb.onTrade(Number(b.dataset.trade))));
      card.querySelectorAll<HTMLButtonElement>('[data-fulfill]').forEach((b) =>
        b.addEventListener('click', () => this.cb.onFulfillDemand(Number(b.dataset.fulfill))));
      card.querySelectorAll<HTMLButtonElement>('[data-sell]').forEach((b) =>
        b.addEventListener('click', () => {
          const [idx, good] = (b.dataset.sell ?? '').split(':');
          this.cb.onSellToTribe(Number(idx), good as GoodId);
        }));
      this.$('[data-diplo-close]')?.addEventListener('click', () => {
        this.diploOpen = false;
        this.refresh();
      });
      return;
    }
    if (s.pendingEvents.length > 0) {
      const ev = s.pendingEvents[0];
      modal.classList.remove('hidden');
      card.innerHTML = `
        <div class="ev-year">${ev.year}</div>
        <h3 class="ev-title">${ev.title}</h3>
        <p class="ev-body">${ev.body}</p>
        <div class="ev-choices">
          ${(ev.choices ?? []).map((c, i) => `
            <div class="choice">
              <button data-cho="${i}" class="btn">${c.label}</button>
              <div class="ctx-dim choice-hint">${c.hint}</div>
            </div>`).join('')}
        </div>`;
      card.querySelectorAll<HTMLButtonElement>('[data-cho]').forEach((b) =>
        b.addEventListener('click', () => this.cb.onEventChoice(ev.id, Number(b.dataset.cho))));
      return;
    }
    modal.classList.add('hidden');
  },

  settingsHtml(s: GameState): string {
    const set = getSettings();
    return `
      <div class="ctx-title">Settings</div>
      <label class="set-row"><input type="checkbox" data-setting="fog" ${set.fog ? 'checked' : ''}/> Fog of war <span class="dim">hide what your colony has not seen</span></label>
      <label class="set-row"><input type="checkbox" data-setting="sound" ${set.sound ? 'checked' : ''}/> Sound <span class="dim">small synthesised effects</span></label>
      <label class="set-row"><input type="checkbox" data-setting="music" ${set.music ? 'checked' : ''}/> Sea music <span class="dim">a slow synthesised pad</span></label>
      <div class="ctx-sub">Colony code</div>
      <div class="ctx-dim">Every action of this colony, from the seed out — paste it anywhere to replay the game to this exact moment.</div>
      <textarea id="code-out" class="code-box" readonly rows="3" spellcheck="false">${encodeCode(s).slice(0, 120000)}</textarea>
      <div class="train-row"><button id="btn-copy-code" class="btn btn-small">Copy</button></div>
      <textarea id="code-in" class="code-box" rows="3" spellcheck="false" placeholder="Paste a colony code to adopt it"></textarea>
      <div class="train-row"><button id="btn-adopt-code" class="btn btn-small">Adopt colony code</button></div>
      <div class="train-row"><button data-settings-close class="btn btn-small">Close</button></div>`;
  },

  researchHtml(s: GameState): string {
    const mine = s.researched[s.player] ?? [];
    const pool = s.insight[s.player] ?? 0;
    const rows = TECHS.map((tech) => {
      const done = mine.includes(tech.id);
      const locked = s.era < tech.era;
      const affordable = pool >= tech.cost;
      const state = done ? 'done' : locked ? 'locked' : affordable ? 'ready' : 'poor';
      return `
        <div class="tech-row tech-${state}">
          <div class="tech-main">
            <div class="tech-name">${tech.name}${done ? ' ✓' : ''}</div>
            <div class="tech-desc">${tech.desc}</div>
          </div>
          <div class="tech-side">
            ${done ? '<span class="tech-tag">Mastered</span>'
              : locked ? `<span class="tech-tag">Age of ${tech.era === 3 ? 'Revolution' : 'Trade'}</span>`
              : `<button data-tech="${tech.id}" class="btn btn-small btn-primary" ${affordable ? '' : 'disabled'}>Master · ✦${tech.cost}</button>`}
          </div>
        </div>`;
    }).join('');
    const called = s.founders[s.player] ?? [];
    const fRows = FOUNDERS.map((f) => {
      const done = called.includes(f.id);
      const locked = s.era < f.era;
      const afford = pool >= f.cost;
      const state = done ? 'done' : locked ? 'locked' : afford ? 'ready' : 'poor';
      return `
        <div class="tech-row tech-${state}">
          <div class="tech-main">
            <div class="tech-name">${f.name}${done ? ' ✓' : ''}</div>
            <div class="tech-desc">${f.desc}</div>
          </div>
          <div class="tech-side">
            ${done ? '<span class="tech-tag">In the colony</span>'
              : locked ? `<span class="tech-tag">Age of ${f.era === 3 ? 'Revolution' : 'Trade'}</span>`
              : `<button data-founder="${f.id}" class="btn btn-small btn-primary" ${afford ? '' : 'disabled'}>Send for · ✦${f.cost}</button>`}
          </div>
        </div>`;
    }).join('');
    return `
      <h3 class="modal-title">The Learned Men</h3>
      <p class="ev-body">Insight gathers where people read, worship, and mill grain: each fed town yields a little, more with a Meeting House or Mill. Spend it here to master a craft for the whole colony.</p>
      <div class="tech-list">${rows}</div>
      <h3 class="modal-title" style="margin-top:18px">Founders &amp; Notables</h3>
      <p class="ev-body">Word of a serious colony reaches Europe, and its ablest people answer. Each comes once and keeps his promise forever.</p>
      <div class="tech-list">${fRows}</div>
      <button data-research-close class="btn" style="margin-top:14px">Close</button>
    `;
  },

  diploHtml(s: GameState): string {
    const owners = [s.player, ...s.rivals];
    const rows = s.tribes.map((tr, i) => {
      const known = s.visible[tr.r * s.mapW + tr.q] || tr.contact[s.player] || tr.alliance === s.player;
      if (!known) return null;
      const lost = tr.popStart > 0 ? Math.round((1 - tr.pop / tr.popStart) * 100) : 0;
      const markers = owners
        .map((o) => `<div class="stance-marker" style="left:${50 + (tr.stance[o] ?? 0) / 2}%;background:${OWNER_HEX[o]}"></div>`)
        .join('');
      const alliance =
        tr.alliance === s.player
          ? `<span class="alliance-badge ally-you">ALLIED WITH YOU</span>`
          : tr.alliance !== 'none'
            ? `<span class="alliance-badge ally-fra">ALLIED WITH ${EMPIRE_NAMES[tr.alliance].toUpperCase()}</span>`
            : `<span class="alliance-badge ally-none">Neutral</span>`;
      const offerHint =
        tr.alliance === 'none' && !tr.allianceOffered
          ? `<div class="ctx-dim">An alliance is offered once your standing reaches <b>50</b> and leads every rival's.</div>`
          : tr.alliance === 'none' && tr.allianceOffered
            ? `<div class="ctx-dim">Their offer has passed.</div>`
            : '';
      const stanceText = owners.map((o) => `${o === s.player ? 'You' : EMPIRE_NAMES[o]} ${stanceLabel(tr.stance[o] ?? 0)}`).join(' · ');
      const tradeText = owners.filter((o) => tr.trade[o]).map((o) => (o === s.player ? 'trade open' : `${EMPIRE_NAMES[o]} trade`)).join(' · ');
      const goodName = (g: GoodId) => GOODS.find((x) => x.id === g)?.name ?? g;
      const produceNames = tr.produces.map(goodName).join(', ');
      const wantGoods = tr.wants.slice(0, 3);
      const sellBtns = wantGoods.map((g) => {
        const hasStock = s.towns.some((t) => t.owner === s.player && t.stock[g] > 0);
        const price = Math.round(s.prices[g] * 0.6);
        return `<button data-sell="${i}:${g}" class="btn btn-small" ${hasStock ? '' : 'disabled'} title="Trade one ${goodName(g).toLowerCase()} from your nearest stocked town">Trade ${goodName(g)} → £${price}</button>`;
      }).join('');
      return `
      <div class="diplo-row">
        <div class="diplo-name">${tr.name}
          <span class="ctx-dim"> · ${tr.pop} people${lost > 0 ? ` <span class="dim">(−${lost}%)</span>` : ''}</span>
          ${alliance}
        </div>
        <div class="stance-bar">${markers}</div>
        <div class="ctx-dim">${stanceText}${tradeText ? ` · ${tradeText}` : ''}</div>
        <div class="ctx-dim">Their lands yield <b>${produceNames}</b>; they covet ${wantGoods.map(goodName).join(', ')}.</div>
        ${this.demandLine(s, tr, i)}
        ${offerHint}
        <div class="diplo-btns">
          <button data-gift="${i}" class="btn btn-small" ${tr.alliance !== 'none' ? 'disabled' : ''}>Gift £15</button>
          <button data-trade="${i}" class="btn btn-small" ${tr.trade[s.player] || (tr.stance[s.player] ?? 0) < -30 ? 'disabled' : ''}>
            ${tr.trade[s.player] ? 'Trade open' : 'Open trade £20'}
          </button>
        </div>
        ${tr.contact[s.player] ? `<div class="train-row" style="margin-top:6px">${sellBtns}</div>` : ''}
      </div>`;
    }).filter(Boolean).join('');
    const knownCount = s.tribes.filter((tr) => s.visible[tr.r * s.mapW + tr.q] || tr.contact[s.player] || tr.alliance === s.player).length;
    const unknownNote = knownCount < s.tribes.length ? `<p class="ctx-dim">You have not yet laid eyes on every people of this land — ${s.tribes.length - knownCount} nation${s.tribes.length - knownCount > 1 ? 's' : ''} lie beyond your sight.</p>` : '';
    const legend = owners.map((o) => `<span class="stance-dot" style="background:${OWNER_HEX[o]}"></span> ${o === s.player ? 'yours' : EMPIRE_NAMES[o].toLowerCase()}`).join(' · ');
    const rivalNames = s.rivals.map((r) => EMPIRE_NAMES[r]).join(' and ');
    return `
      <div class="ev-year">Diplomacy</div>
      <h3 class="ev-title">The Peoples of this Land</h3>
      <p class="ev-body">They were here long before your ships. Trade and words buy time;
      taking their land buys a grudge that outlives you. ${rivalNames} court${s.rivals.length === 1 ? 's' : ''} them too —
      each marker is an empire's standing: ${legend}. Win a nation's heart to <b>50</b> and lead the field, and you may have an ally.</p>
      ${rows}
      ${unknownNote}
      <button data-diplo-close class="btn btn-primary">Close</button>`;
  },

  demandLine(s: GameState, tr: Tribe, i: number): string {
    if (!tr.contact[s.player]) return '';
    if (tr.demand.length === 0) return '<div class="ctx-dim">The village seeks nothing this season.</div>';
    const myTowns = s.towns.filter((t) => t.owner === s.player);
    const parts = tr.demand.map((d) => {
      const have = myTowns.reduce((a, t) => a + t.stock[d.good], 0);
      const cls = have >= d.qty ? 'up' : 'down';
      return `<span class="${cls}">${d.qty} ${GOODS.find((x) => x.id === d.good)?.name.toLowerCase()} (have ${have})</span>`;
    }).join(' + ');
    const reward = Math.round(tr.demand.reduce((a, d) => a + d.qty * s.prices[d.good] * 1.5, 0));
    const ready = tr.demand.every((d) => myTowns.reduce((a, t) => a + t.stock[d.good], 0) >= d.qty);
    return `<div class="ctx-dim">They seek in trade: ${parts} — reward £${reward} <span class="dim">(a premium of half again)</span>.</div>
      <div class="diplo-btns"><button data-fulfill="${i}" class="btn btn-small" ${ready ? '' : 'disabled'}>Fulfil the demand</button></div>`;
  },

  renderVictory(s: GameState) {
    const v = this.$('#victory');
    if (!s.victory) {
      v.classList.add('hidden');
      return;
    }
    v.classList.remove('hidden');
    const winner = s.victory.owner ?? s.player;
    const engTowns = s.towns.filter((t) => t.owner === winner);
    const kind = s.victory.kind;
    const who = ` <span class="dim">· ${EMPIRE_NAMES[winner]}</span>`;
    this.$('#victory-card').innerHTML = kind === 'expelled'
      ? `<h3 class="ev-title" style="color:#e08a58">THE COLONY IS CLOSED${who}</h3>
      <p class="ev-body">In ${s.victory.year}: ${s.victory.reason.toLowerCase()}
      The garrisons stand in the streets, the ports are blockaded, and the experiment in self-government ends.</p>
      <p class="intro-note">The Crown does not forget defiance — it occupies it.</p>
      <button data-again class="btn btn-primary">Play again</button>`
      : kind === 'faith'
        ? `<h3 class="ev-title">A CITY UPON A HILL${who}</h3>
      <p class="ev-body">In ${s.victory.year}, ${s.victory.reason.toLowerCase()}
      ${engTowns.length} meeting houses rang at once, and the colony no longer answers to the Crown —
      it answers to its own conscience.</p>
      <p class="intro-note">In the long history, this is the other America: the commonwealth that governed
      itself before the guns ever spoke.</p>
      <button data-again class="btn btn-primary">Play again</button>`
        : kind === 'wealth'
          ? `<h3 class="ev-title">THE LEDGER${who}</h3>
      <p class="ev-body">In ${s.victory.year}, ${s.victory.reason.toLowerCase()}
      The merchant houses of London keep the books, and the books keep the colony.</p>
          <p class="intro-note">In the long history, empire is mostly an accounting practice.
      You have simply done the arithmetic first.</p>
          <button data-again class="btn btn-primary">Play again</button>`
          : `<h3 class="ev-title">INDEPENDENCE${who}</h3>
      <p class="ev-body">In ${s.victory.year}, the colony stops answering to the Crown.
      ${engTowns.length} towns signed the paper; the ${s.year - 1607} years it took will be taught in schools that do not yet exist.</p>
      <p class="intro-note">In the long history, the paper is the easy part.
      What came next — the war, the revolution, the nation — is the rest of the story.</p>
      <button data-again class="btn btn-primary">Play again</button>`;
    this.$('#victory-card [data-again]').addEventListener('click', () => this.cb.onNewGame());
  },
};

function terrainName(t: Tile['terrain']): string {
  return { ocean: 'Open water', coast: 'Sandy shore', river: 'River', grass: 'Meadow', forest: 'Forest', hills: 'Hills', mountain: 'Mountains' }[t];
}
function terrainDesc(t: Tile['terrain']): string {
  return {
    ocean: 'Ships need deep water to anchor. Settlers cannot swim.',
    coast: 'Beach sand: you can walk on it, but it is too soft to build on. Docks and tobacco belong to the grass behind the beach.',
    river: 'Running water from the hills to the sea. A town on its bank can raise a dock and ship without a wagon road. Crossable at the fords.',
    grass: 'Good farmland: wheat and tobacco.',
    forest: 'Timber, and furs in the north.',
    hills: 'Rough ground. Few would settle here.',
    mountain: 'Too steep for fields or towns.',
  }[t];
}


