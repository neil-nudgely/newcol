import type { GoodId, ImprovementId, Owner, UnitKind } from './types';

export const SETTLED_MOVEMENT = 3;
export const FRIGATE_MOVEMENT = 4;
export const SETTLER_COST = 20;
export const MILITIA_COST = 25;
export const FRIGATE_COST = 60;
export const TRAIN_COST: Record<UnitKind, number> = { settler: SETTLER_COST, militia: MILITIA_COST, soldier: 20, ranger: 10, frigate: FRIGATE_COST };

export type Era = 1 | 2 | 3;
export type Season = 0 | 1 | 2 | 3;

export interface GoodDef {
  id: GoodId;
  name: string;
  base: number;
  demand: number;
  era: Era;
  /** The seasons (0 Spring, 1 Summer, 2 Autumn, 3 Winter) this good is gathered. */
  seasons: Season[];
  /** Europe market parameters, adapted from the 1994 market table (docs/original-mechanics.md §2). */
  market: {
    /** Deep-Europe initial stock of this good: how much flow it takes to move the price. */
    supply: number;
    /** Bid–ask spread (the original's 'burden' + 1). Buying always costs this over selling. */
    spread: number;
    /** Fraction of delivered supply Europe digests each season (the original's 'attrition'). */
    recover: number;
    /** New World crops can never spike more than +2 over their base price. */
    newWorld: boolean;
  };
  note: string;
}

export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'] as const;
export const SEASONS_PER_YEAR = 4;

export const ERA_II_YEAR = 1630;
export const ERA_III_YEAR = 1650;
export const ERA_NAMES: Record<Era, string> = { 1: 'Colonial Times', 2: 'The Age of Trade', 3: 'The Revolutionary Tide' };

export const GOODS: readonly GoodDef[] = [
  { id: 'tobacco', name: 'Tobacco', base: 8, demand: 12, era: 1, seasons: [2], market: { supply: 90, spread: 2, recover: 0.06, newWorld: true }, note: 'Coastal grassland — cured in autumn' },
  { id: 'wheat', name: 'Wheat', base: 5, demand: 15, era: 1, seasons: [2], market: { supply: 120, spread: 3, recover: 0.1, newWorld: false }, note: 'Grassland — the autumn harvest' },
  { id: 'lumber', name: 'Lumber', base: 3, demand: 18, era: 1, seasons: [0], market: { supply: 110, spread: 4, recover: 0.04, newWorld: false }, note: 'Forest — felled and driven out in spring' },
  { id: 'furs', name: 'Furs', base: 6, demand: 8, era: 1, seasons: [3], market: { supply: 80, spread: 2, recover: 0.14, newWorld: true }, note: 'Northern forest — the winter hunt' },
  { id: 'sugar', name: 'Sugar', base: 10, demand: 8, era: 2, seasons: [2], market: { supply: 85, spread: 2, recover: 0.08, newWorld: true }, note: 'Warm coastal grassland — the autumn cane harvest' },
  { id: 'indigo', name: 'Indigo', base: 12, demand: 6, era: 3, seasons: [2], market: { supply: 70, spread: 2, recover: 0.08, newWorld: true }, note: 'Grassland — the autumn dye crop' },
  { id: 'silver', name: 'Silver', base: 15, demand: 5, era: 1, seasons: [0, 1, 2], market: { supply: 60, spread: 1, recover: 0.05, newWorld: true }, note: 'Hills — the mountain lodes' },
  { id: 'iron', name: 'Iron', base: 9, demand: 6, era: 1, seasons: [0, 1, 2], market: { supply: 95, spread: 2, recover: 0.05, newWorld: false }, note: 'Hills — ore in the uplands' },
  { id: 'spices', name: 'Spices', base: 11, demand: 7, era: 1, seasons: [1], market: { supply: 75, spread: 2, recover: 0.06, newWorld: true }, note: 'Warm coastal grassland — the summer gathering' },
  // New World raw material for the loom.
  { id: 'cotton', name: 'Cotton', base: 7, demand: 9, era: 1, seasons: [2], market: { supply: 85, spread: 2, recover: 0.06, newWorld: true }, note: 'Grassland — picked in autumn' },
  // Manufactured goods: workshops turn raw stock into wealth. Gathered all seasons.
  { id: 'cloth', name: 'Cloth', base: 13, demand: 8, era: 1, seasons: [0, 1, 2, 3], market: { supply: 60, spread: 2, recover: 0.06, newWorld: true }, note: 'Woven from cotton at the Weaver' },
  { id: 'coats', name: 'Coats', base: 12, demand: 7, era: 1, seasons: [0, 1, 2, 3], market: { supply: 65, spread: 2, recover: 0.06, newWorld: true }, note: 'Dressed from furs at the Tannery' },
  { id: 'cigars', name: 'Cigars', base: 14, demand: 6, era: 1, seasons: [0, 1, 2, 3], market: { supply: 60, spread: 2, recover: 0.06, newWorld: true }, note: 'Rolled from tobacco at the Refinery' },
  { id: 'rum', name: 'Rum', base: 14, demand: 7, era: 2, seasons: [0, 1, 2, 3], market: { supply: 55, spread: 2, recover: 0.07, newWorld: true }, note: 'Distilled from sugar at the Refinery' },
  { id: 'tools', name: 'Tools', base: 8, demand: 8, era: 1, seasons: [0, 1, 2, 3], market: { supply: 70, spread: 1, recover: 0.05, newWorld: false }, note: 'Forged from iron at the Smithy — the Indians prize them' },
  { id: 'muskets', name: 'Muskets', base: 12, demand: 6, era: 2, seasons: [0, 1, 2, 3], market: { supply: 60, spread: 2, recover: 0.04, newWorld: false }, note: 'Gunned from tools at the Armory' },
  // The currency of the fur trade: bought in Europe, spent with the nations.
  { id: 'tradeGoods', name: 'Trade Goods', base: 6, demand: 6, era: 1, seasons: [], market: { supply: 50, spread: 1, recover: 0.04, newWorld: false }, note: 'Kettles, cloth, trinkets — bought in Europe, gifted and traded with the nations' },
] as const;

// ---------- empires & traits ----------

export const EMPIRE_NAMES: Record<Owner, string> = {
  england: 'England',
  france: 'France',
  spain: 'Spain',
  netherlands: 'Netherlands',
  sweden: 'Sweden',
  portugal: 'Portugal',
  denmark: 'Denmark',
  prussia: 'Prussia',
  russia: 'Russia',
};

export const DEMOS: Record<Owner, string> = {
  england: 'English',
  france: 'French',
  spain: 'Spanish',
  netherlands: 'Dutch',
  sweden: 'Swedish',
  portugal: 'Portuguese',
  denmark: 'Danish',
  prussia: 'Prussian',
  russia: 'Russian',
};

export const EMPIRE_TRAITS: Record<Owner, string> = {
  england: 'The tobacco country: +1 tobacco from every field.',
  france: 'The fur trade: +1 furs, and the nations of the land start 15 points friendlier.',
  spain: 'The silver crown: +£50 to open with, and +1 silver from the lodes.',
  netherlands: 'The free traders: the Crown takes only 30% of your cargo, not half.',
  sweden: 'The iron masters: forts cost £60 and defend for 12.',
  portugal: 'The navigators: the finest sailors and traders on the water — your cargo sells for 10% more.',
  denmark: 'The hardies: sturdy colonists from the cold north — your towns grow a head faster.',
  prussia: 'The drillmasters: militiamen cost only £15 and defend for 4 instead of 3.',
  russia: 'The endurers: people from the frozen north — famine claims half as many lives.',
};

export const SIGNATURE_GOOD: Record<Owner, GoodId> = {
  england: 'tobacco',
  france: 'furs',
  spain: 'silver',
  netherlands: 'spices',
  sweden: 'iron',
  portugal: 'spices',
  denmark: 'wheat',
  prussia: 'wheat',
  russia: 'furs',
};

export const RIVAL_OF: Record<Owner, Owner> = {
  england: 'france',
  france: 'england',
  spain: 'portugal',
  netherlands: 'denmark',
  sweden: 'france',
  portugal: 'spain',
  denmark: 'netherlands',
  prussia: 'spain',
  russia: 'france',
};

export const crownDutyFor = (owner: Owner): number => (owner === 'netherlands' ? 0.3 : 0.5);
export const fortCostFor = (owner: Owner): number => (owner === 'sweden' ? 60 : 100);
export const fortDefenseFor = (owner: Owner): number => (owner === 'sweden' ? 12 : 10);
export const exportBonusFor = (owner: Owner): number => (owner === 'portugal' ? 0.1 : 0);
export const growthBonusFor = (owner: Owner): number => (owner === 'denmark' ? 0.1 : 0);
export const militiaCostFor = (owner: Owner): number => (owner === 'prussia' ? 15 : MILITIA_COST);
export const militiaDefenseFor = (owner: Owner): number => (owner === 'prussia' ? 4 : 3);
export const famineLossFor = (owner: Owner): number => (owner === 'russia' ? 1 : 2);

export const SHIP_CARGO_CAP = 12;
// A town's storehouse holds so much of each good; the rest spoils on the floor.
export const STORAGE_CAP = 30;
// How much one town may land on Europe in a season before the market factor refuses more.
export const SALES_CAP = 100;
export const SALES_CAP_CUSTOM = 100;
export const PRICE_FLOOR_SUPPLY = 12;
export const PRICE_MIN = 0.5;
export const PRICE_MAX = 2;

export const GOOD_BY_ID: Record<GoodId, GoodDef> = Object.fromEntries(
  GOODS.map((g) => [g.id, g]),
) as Record<GoodId, GoodDef>;

export interface ManufactureLink {
  /** Raw goods consumed per conversion. */
  in: [GoodId, number][];
  /** Good produced per conversion. */
  out: GoodId;
  /** Conversions attempted each season. */
  cap: number;
}

export interface ImprovementDef {
  name: string;
  cost: number;
  turns: number;
  era: Era;
  desc: string;
  /** Workshop conversions performed every season in a fed town. */
  manufacture?: ManufactureLink[];
}

export const IMPROVEMENTS: Record<ImprovementId, ImprovementDef> = {
  granary: { name: 'Granary', cost: 30, turns: 1, era: 1, desc: 'Stores the harvest: +5 food, faster growth. Hungry towns produce nothing.' },
  mill: { name: 'Mill', cost: 40, turns: 1, era: 1, desc: 'Grinds grain and saws timber: +wheat, +lumber.' },
  meetinghouse: { name: 'Meeting House', cost: 60, turns: 2, era: 1, desc: 'A congregation with a voice of its own: +faith, −loyalty to the Crown. Three such towns at faith 60 can proclaim a city upon a hill.' },
   dock: { name: 'Dock', cost: 50, turns: 2, era: 1, desc: 'Ships your goods to Europe. Needs open water at the town\u2019s edge. Two turns to build; cargo pays on arrival.' },
   wagondepot: { name: 'Wagon Depot', cost: 40, turns: 1, era: 1, desc: 'Carts and mule teams for the inland: haul goods to your nearest port, which ships them on. A toll is taken on every load.' },
  fort: { name: 'Fort', cost: 100, turns: 3, era: 1, desc: 'Stones and muskets: tribal raids cannot take the town.' },
  tobaccobarn: { name: 'Tobacco Barn', cost: 40, turns: 1, era: 2, desc: 'Curing racks for the leaf: +2 tobacco per turn.' },
  artillery: { name: 'Artillery', cost: 80, turns: 3, era: 3, desc: 'Cannon for the ramparts: +5 defence when the Crown\u2019s garrisons land.' },
  weaver: { name: 'Weaver', cost: 55, turns: 2, era: 1, desc: 'The loom: 2 cotton into 1 cloth each season. Cloth sells high and the nations want it.', manufacture: [{ in: [['cotton', 2]], out: 'cloth', cap: 2 }] },
  tannery: { name: 'Tannery', cost: 50, turns: 2, era: 1, desc: 'The frames: 2 furs into 1 coat each season. A winter hunt feeds a year of coats.', manufacture: [{ in: [['furs', 2]], out: 'coats', cap: 2 }] },
  smithy: { name: 'Smithy', cost: 60, turns: 2, era: 1, desc: 'The forge: 2 iron into 1 tool each season. Tools arm the other workshops — and please the nations.', manufacture: [{ in: [['iron', 2]], out: 'tools', cap: 2 }] },
  refinery: { name: 'Refinery', cost: 70, turns: 2, era: 2, desc: 'The still and the rolling bench: 2 sugar into rum, 2 tobacco into cigars, each season.', manufacture: [{ in: [['sugar', 2]], out: 'rum', cap: 2 }, { in: [['tobacco', 2]], out: 'cigars', cap: 2 }] },
  customhouse: { name: 'Custom House', cost: 80, turns: 2, era: 2, desc: 'A clerk, a ledger, and the King\u2019s seal at the quay: your town may land £200 of goods on Europe each season instead of £100 before the market factor turns against you.' },
  armory: { name: 'Armory', cost: 75, turns: 2, era: 2, desc: 'The gun bench: 2 tools into 1 musket each season. Muskets for the trade, and for soldiers yet to come.', manufacture: [{ in: [['tools', 2]], out: 'muskets', cap: 2 }] },
};

export const VOYAGE_TURNS = 1;
