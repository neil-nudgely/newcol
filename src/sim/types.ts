import type { Rng } from './rng';

export type Owner =
  | 'england' | 'france' | 'spain' | 'netherlands' | 'sweden'
  | 'portugal' | 'denmark' | 'prussia' | 'russia';
export type Terrain = 'ocean' | 'coast' | 'river' | 'grass' | 'forest' | 'hills' | 'mountain';
export type GoodId = 'tobacco' | 'wheat' | 'lumber' | 'furs' | 'sugar' | 'indigo' | 'silver' | 'iron' | 'spices'
  | 'cotton' | 'cloth' | 'cigars' | 'coats' | 'rum' | 'tools' | 'muskets' | 'tradeGoods';
export type ImprovementId = 'granary' | 'meetinghouse' | 'mill' | 'dock' | 'fort' | 'tobaccobarn' | 'artillery' | 'wagondepot'
  | 'weaver' | 'tannery' | 'smithy' | 'refinery' | 'armory' | 'customhouse';
export type TribeId =
  | 'powhatan' | 'iroquois'
  | 'algonquin' | 'huron'
  | 'timucua' | 'calusa'
  | 'lenape' | 'mohican'
  | 'susquehannock' | 'nanticoke'
  | 'apalachee' | 'creek'
  | 'taino' | 'carib'
  | 'rappahannock' | 'patuxent'
  | 'beothuk' | 'mikmaq';

export interface Tile {
  q: number;
  r: number;
  terrain: Terrain;
  elev: number;
}

export interface Town {
  id: number;
  name: string;
  owner: Owner;
  q: number;
  r: number;
  pop: number;
  improvements: ImprovementId[];
  stock: Record<GoodId, number>;
  loyalty: number;
  drought: number;
  faith: number;
  foundedYear: number;
  fed: boolean;
  food: number;
  trainedThisTurn: boolean;
  /** Gross export value shipped from this town since the season turned (Custom House quota). */
  seasonGross: number;
  shippedThisTurn: boolean;
  foundedThisTurn: boolean;
  construction: { imp: ImprovementId; turnsLeft: number } | null;
  /** Turn until which an outbreak will pass over this town (survivors' immunity). */
  immuneUntil: number;
  /** Empires that bought this land from its first people; they no longer resent it. */
  landBought: Owner[];
}

export type Alliance = 'none' | Owner;

export interface Tribe {
  id: TribeId;
  name: string;
  q: number;
  r: number;
  pop: number;
  popStart: number;
  /** Standing with each empire on the board (player + rivals). */
  stance: Record<Owner, number>;
  trade: Record<Owner, boolean>;
  contact: Record<Owner, boolean>;
  claimRadius: number;
  alliance: Alliance;
  allianceOffered: boolean;
  /** Goods this nation's lands and hands yield — what it can sell to you. */
  produces: GoodId[];
  /** Goods this nation covets and will pay for — what you can sell to it. */
  wants: GoodId[];
  /** The nation's home ground — its hunting migrations roam within a day's walk of this. */
  homeQ: number;
  homeR: number;
  /** The event that follows first contact (the fever, a caravan, a council). */
  followUp: 'plague' | 'caravan' | 'council' | null;
  /** Turns until that follow-up plays out (null = none pending). */
  followUpIn: number | null;
  /** Turn until which an outbreak will pass over this nation (survivors' immunity). */
  immuneUntil: number;
  /** What this nation seeks from traders this cycle — the original's village demand lists. */
  demand: { good: GoodId; qty: number }[];
  /** Seasons until the demand list changes. */
  demandTurns: number;
  /** How many demands this nation has seen fulfilled (counts goodwill). */
  demandsFulfilled: number;
}

export interface Ship {
  id: number;
  owner: Owner;
  fromQ: number;
  fromR: number;
  good: GoodId;
  amount: number;
  t: number;
  voyage: number;
  value: number;
  escort: boolean;
  cargo: Partial<Record<GoodId, number>>;
  townName: string;
}

export type UnitKind = 'settler' | 'militia' | 'soldier' | 'ranger' | 'frigate';

export interface Unit {
  id: number;
  owner: Owner;
  kind: UnitKind;
  q: number;
  r: number;
  moveLeft: number;
  bombardedThisTurn: boolean;
  /** Battle-hardened: +1 strength per win, up to 2. */
  veterans?: number;
}

/** A cleared lane between two of your towns: wagons pass toll-free, your people walk it cheap. */
export interface Road {
  owner: Owner;
  a: number;
  b: number;
  /** Tile indices the lane runs over. */
  tiles: number[];
}

export type EventKind =
  | 'tax'
  | 'navact'
  | 'contact'
  | 'plague'
  | 'caravan'
  | 'council'
  | 'raid'
  | 'visit'
  | 'troops'
  | 'info'
  | 'era'
  | 'alliance'
  | 'winter'
  | 'outbreak'
  | 'declare';

export interface EventChoice {
  label: string;
  hint: string;
}

export interface GameEvent {
  id: number;
  year: number;
  kind: EventKind;
  title: string;
  body: string;
  data?: number;
  /** Settlement key ('t:{townId}' | 'g:{tribeIdx}') — present on outbreak events. */
  settlement?: string;
  choices?: EventChoice[];
}

/** A spreading disease outbreak. `reached` holds settlement keys it has already infected. */
export interface Outbreak {
  id: number;
  name: string;
  age: number;
  duration: number;
  source: string;
  reached: string[];
  /** True when a quarantined town penned the fever in — it will age out, not spread. */
  halted?: boolean;
}

export type DeclareKind = 'independence' | 'faith' | 'wealth';

export interface Victory {
  kind: 'independence' | 'faith' | 'wealth' | 'expelled';
  year: number;
  reason: string;
  /** Who won (or was expelled); the original player when unset. */
  owner?: Owner;
}

export interface Garrison {
  targetTownId: number;
  arriveIn: number;
  strength: number;
}

export interface Occupation {
  townId: number;
  turnsLeft: number;
}

export interface GameState {
  seed: number;
  player: Owner;
  rivals: Owner[];
  turn: number;
  year: number;
  /** 0 Spring, 1 Summer, 2 Autumn, 3 Winter — four seasons make a year. */
  season: number;
  rng: Rng;
  rngCalls: number;
  mapW: number;
  mapH: number;
  tiles: Tile[];
  towns: Town[];
  nextTownId: number;
  tribes: Tribe[];
  ships: Ship[];
  nextShipId: number;
  units: Unit[];
  nextUnitId: number;
  treasury: Record<Owner, number>;
  income: Record<Owner, number>;
  firstExport: boolean;
  /** Per-owner lifetime export value landed on Europe (the wealth race). */
  exportValBy: Record<Owner, number>;
  /** Player's Europe sell prices (mirror of sellP[player]) for UI convenience. */
  prices: Record<GoodId, number>;
  prevPrices: Record<GoodId, number>;
  /** Per-owner Europe markets: delivered supply awaiting digestion. */
  supply: Record<Owner, Record<GoodId, number>>;
  /** Per-owner Europe sell prices. */
  sellP: Record<Owner, Record<GoodId, number>>;
  /** Per-owner Europe buy prices (sell + spread). */
  buyP: Record<Owner, Record<GoodId, number>>;
  events: GameEvent[];
  pendingEvents: GameEvent[];
  nextEventId: number;
  log: string[];
  defiance: number;
  embargoNoted: boolean;
  navActPassed: boolean;
  visited: boolean;
  garrison: Garrison | null;
  garrisonsSent: number;
  occupations: Occupation[];
  occupationsTaken: number;
  era: 1 | 2 | 3;
  /** Accumulated research insight per empire on the board. */
  insight: Record<Owner, number>;
  /** Tech ids researched per empire on the board. */
  researched: Record<Owner, string[]>;
  /** Founder ids each empire has answered. */
  founders: Record<Owner, string[]>;
  /** Skills taught by the nations for faithful trade (trapping, planting, scouting). */
  skills: Record<Owner, string[]>;
  /** Onboarding hints already shown (client-learned, one-time each). */
  tutorial?: string[];
  /** The player's recorded actions, for colony codes and replay. */
  actionLog?: Array<{ t: number; a: string; args: unknown[] }>;
  victory: Victory | null;
  /** Whichever colony the Crown's machinery (duty, garrisons, war) is aimed at — the first governor's. */
  crownSubject: Owner;
  /** Owners controlled by humans on this device (hotseat); defaults to just the starting player. */
  humans?: Owner[];
  playerStart: { q: number; r: number };
  /** Active disease outbreaks. */
  outbreaks: Outbreak[];
  nextOutbreakId: number;
  /** The King's duty on your sales, 10-75%. He only ever raises it. */
  taxRate: number;
  /** Every pound of duty ever paid — the King spends it on regiments to send at you. */
  taxesPaid: number;
  /** True while your ports are sealed to the mother country (boycott). */
  tradeSevered: boolean;
  /** War of independence, once declared. */
  warActive: boolean;
  /** Finished lanes between your towns (docs §9). */
  roads: Road[];
  /** Lanes under construction. */
  roadWork: Array<{ owner: Owner; from: number; to: number; turnsLeft: number }>;
  warTurns: number;
  refIn: number;
  wavesFired: number;
  /** Fog of war: tiles the player has ever seen, and tiles currently in sight. */
  explored: boolean[];
  visible: boolean[];
}
