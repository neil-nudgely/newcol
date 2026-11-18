# Original Colonization (1994) → newcol mechanics mapping

Purpose: ground-up comparison of Sid Meier's Colonization (1994) mechanics — as recovered
by the community reverse-engineering effort — against our implementation, so we can pick
which original systems to adopt.

## Sources

| Source | What for | Notes |
|---|---|---|
| Civilization Wiki (Fandom), "Market system (Col)", "Goods (Col)", "Tax rate (Col)" | verified 1994 data tables | CC-BY-SA; tables reproduced with attribution below |
| [FreeCol](https://github.com/FreeCol/freecol) (GPL-2.0 Java reimplementation, active to 2026) | rules detail: natives, Europe, REF, founders | **clean-room rule: read for facts, never copy code/XML** |
| [sjmelia/civd](https://github.com/sjmelia/civd) + book | Civ1 DOS engine (Colonization's direct base) | trade box, city box, movement |
| OpenCiv1 | Civ1 disassembly rewrite | engine cross-check |
| strategywiki.org Colonization/Overseas relations | tax/boycott behaviour citations | cited by the fandom Tax page |

Legend for **Status**: ✅ we match · 🟡 we approximate · ❌ absent · 🔀 deliberate divergence (ours stays).

Deep-verification step (deferred): shallow-clone FreeCol and read `data/` XML +
`src/.../PriceModel.java` for exact constants:
`git clone --depth 1 --filter=blob:none --sparse https://github.com/FreeCol/freecol && cd freecol && git sparse-checkout set data src/net/sf/freecol/common/model`

---

## 1. Time & turns

- **Original:** 1 turn = 1 year, 1492–1850. Trade voyages take fixed multi-turn crossings.
- **Ours:** 4 seasons = 1 year; seasons gate harvests; goods have real harvest calendars. (`sim.ts endTurn`, `goods.ts GoodDef.seasons`)
- **Status: 🔀** Our seasonal model is richer than the original's annual tick. Keep.
- Gap: none needed; just keep year-based events (tax, eras) calibrated to our 4× cadence.

## 2. Europe market ⭐ biggest fidelity gap

- **Original** (from "Market system (Col)", CC-BY-SA): each good has an 8-parameter market:
  `start1/start2` (initial low/high cargo price), `low/high` (price bounds), `burden`
  (extra bid–ask spread; food burden 7 ⇒ buy/sell spread of 8), `rise`, `fall` (traffic
  indicators the price moves at as supply changes), `attrition` (per-turn drift back toward
  baseline — negative = recovers by rising, positive = decays), `volatility`.
  - Prices are **bid/ask pairs**: you sell at the ask-low, buy at the ask-high.
  - All European markets are *tightly linked*; the Dutch market drifts less (their
    "robust market" trait ≈ gentler rise/fall).
  - Selling floods *your* supply count → price falls; markets recover via attrition.
  - Full original table: Food 1/3/1/6/7/3/2/-1/0; Sugar 4/7/3/7/1/4/6/-8/1; Tobacco 3/5/2/5/1/4/8/-10/1;
    Cotton 2/5/2/5/1/4/6/-11/1; Furs 4/6/2/6/1/4/20/-13/1; Lumber 2/2/2/2/4/3/2/0/0;
    Ore 3/6/2/6/2/2/4/-7/0; Silver 20/20/2/20/-/8/1/-8/2; Horses 2/3/2/11/-/3/2/-3/0;
    Rum/Cigars/Cloth/Coats x/…/1/20/-/4/4/-11..13/1; Trade goods 2/3/2/12/-/2/3/4/0;
    Tools 2/2/2/9/-/2/2/5/0; Muskets 3/3/2/20/-/2/2/6/0.
- **Ours** (`state.ts marketStock/demandSpike`, `sim.ts updatePrices/marketChaos`): one global
  `marketStock` per good; price = base × demand/max(stock) clamped; random fashion spikes
  and rival dumps; single price (no bid/ask).
- **Status: 🟡**
- **Adopt (high value, modest effort):**
  1. Per-good `rise/fall/attrition` drift replaces our random spikes: supply you deliver pushes
     price down by `fall`; idle markets drift up by `rise`; `attrition` decays supply each turn.
  2. Bid/ask spread (burden) — buying (tools for buildings, trade goods) costs more than selling.
  3. Cross-market linkage: rival/AI shipments crash *your* prices too (already partially true
     via `sendShip` giving cargo to the enemy; formalize via shared `marketStock`).
  4. Map Netherlands trait to gentler drift instead of −30% duty (optional flavor swap).

## 3. Goods & production chains ⭐ second biggest gap

- **Original** ("Goods (Col)", CC-BY-SA): 16 goods = 9 raw + 7 manufactured.
  Raw: Cotton, Food, Furs, Lumber, Ore, Silver, Sugar, Tobacco (+Horses bred from food).
  Chains: Tobacco→Cigars, Cotton→Cloth, Furs→Coats, Sugar→Rum, Ore→Tools, Tools→Muskets.
  Manufactured goods sell far higher and need a specialist building + trained workers.
  Trade Goods: bought only in Europe, spent only on natives. Ships are built (hull from lumber).
  Lumber is *also* the construction resource (hammers), Ore→buildings via Tools.
- **Ours** (`goods.ts GOODS`, `sim.ts processTown`, `IMPROVEMENTS`): 9 flat goods, no
  manufacturing; improvements are flat +yield; buildings cost only gold; ships cost gold.
- **Status: ❌ chains / 🟡 goods set**
- **Adopt:**
  1. **Manufacturing**: add `refinery` (Sugar→Rum / Tobacco→Cigars), `weaver` (Cotton→Cloth),
     `tannery` (Furs→Coats), `smithy` (Ore→Tools→Muskets): consume N raw + M seasons → 1 premium good.
     Fits our seasonal engine beautifully (manufacture through winter when fields idle).
  2. **Trade goods as imports**: buyable in Europe, the only native-trade currency (replaces
     "sell wheat to natives").
  3. Our cotton: currently absent — add as a Southern coastal raw good to feed Cloth.
  4. Horses: skip (dragoon tier we don't model); Muskets feed a "soldier" unit tier (see §8).

## 4. Colony internals (specialists, storage, happiness)

- **Original:** a colony is a *list of colonists with professions* (Farmer, Fisherman, Trapper,
  Lumberjack, Tobacco Planter, Cotton Gin, Refinery, Weaver, Artisan, Valet…) each working a
  job slot the terrain/buildings enable; overflow food spoils; goods storage caps per type;
  content/unrest per colonist; education levels (Trained/College) gate specialist quality.
- **Ours:** town = aggregate pop + terrain/improvement yields + fed gate + loyalty/faith.
- **Status: 🔀 (big structural divergence)**
- **Recommendation:** do NOT port the per-colonist model wholesale (it rewrites everything).
  Adopt its *flavor* cheaply:
  1. Storage caps per town (surplus spoils → forces you to ship it, creating the shipping cadence).
  2. Specialist buildings require fed towns + take 1 season (already close).
  3. Keep aggregate model; note the divergence honestly in the UI somewhere ("our towns are an
     abstraction of Reynolds' colonist lists").

## 5. Natives

- **Original:** fixed villages (2–4 per nation), each nation has a **goods list it produces**
  (region-specific: furs north, tobacco/silver south) and a rotating **demand list with
  quantities** (e.g. wants 2 Trade Goods + 1 Muskets); selling demanded goods earns gold,
  reduces "alarm", may trigger **horses/skills gifts**; buying land per tile; missionaries
  (crosses) convert villages and can spark revolt; **smallpox epidemic on contact** (fixed
  event, huge mortality); attacks occur when you settle/trample their land; nations can be
  wiped out entirely; *no formal alliance* — but training + gifts shape behaviour.
- **Ours:** roaming nations (seasonal hunts), terrain-derived `produces`/`wants`, stance
  −100..100 per empire, gift/openTrade/sellToTribe, contact→fever w/ immunity, raids/joint
  strikes, formal alliances.
- **Status: 🟡** — surprisingly close on disease (our epidemic+immunity system is *better
  than* their one-shot smallpox).
- **Adopt:**
  1. **Cyclical demands with quantities**: each nation wants "2×Trade Goods + 1×Muskets";
     fulfilling a demand pays a premium (this is the original's trade *game* — our flat 60%
     sell price has no loop).
  2. **Buy land per tile**: gold-per-tile inside a claim to defuse the −1.5 stance drain —
     gives stance an economic release valve we lack.
  3. **Skills gift**: fulfilled demands occasionally teach a production bonus (trappers:
     +furs in forest towns) — one-time boons, Founder-esque.
- **Keep ours:** roaming hunts (deliberate, more honest to the historical reality), alliances
  (extension), per-empire stance (our multi-rival needs), trade-without-quantity fallback.

## 6. Crown & politics

- **Original:**
  - **Tax = a rate (slider 0–75%), not events**: the King periodically *raises* the rate
    (fixed schedule per difficulty: first tax year 1524–1536, every 14–22 turns).
    You choose: **Accept / Boycott-and-pay-later / Boycott-and-sever-trade** (trade with
    Europe frozen until you buy back in or get Jakob Fugger).
  - Duty applies to *everything* sold in Europe at the current rate.
  - **Sons of Liberty**: each colony produces Liberty Bells from its rebel-leaning colonists;
    declaring independence needs enough bells; higher royal tax → more bells (Paine: bells
    scale with tax rate!).
  - After declaring: **Royal Expeditionary Force** — royal troops land at ports periodically,
    scaled by the *cumulative gold you paid in taxes*; foreign EU allies can be asked for aid.
  - **Royal officials** (governors) sit in your colonies pre-independence, occasionally
    confiscating/levying.
- **Ours** (`sim.ts crownBusiness/crownRetaliation/effectiveDuty`, defiance events):
  50% duty, defiance counter, tax events every 12 years w/ pay/refuse, embargo at defiance 4,
  garrisons arrive in 6 seasons, occupation, expelled defeat.
- **Status: 🟡** — same beats, different instruments.
- **Adopt:**
  1. **Tax slider with consequences** (0–75%): replaces fixed 50% duty. High tax = rich Crown
    (bigger REF) + more unrest/bells; low tax = cheap but the King demands more often.
    Maps 1:1 onto our loyalty/defiance systems.
  2. **Cumulative-taxes-paid funds the enemy** — make `s.garrisonsSent`/REF strength scale
    with lifetime tax paid, not just defiance. (Beautiful "your money builds their army".)
  3. **Boycott as trade embargo YOU choose** (sever Europe trade until bought back) — we
    already have a Crown-side embargo; add the player-side option on the refuse branch.
  4. Liberty Bells as a *third town stock* (with our faith system already parallel to it —
    consider merging: bells = faith produced by meetinghouses scaled by current tax rate).
- **Skip:** royal governors on map (our garrison covers the threat), foreign aid (needs
  great-power diplomacy we don't have).

## 7. Founding Fathers

- **Original:** notable figures emigrate when any colonist reaches education levels; you buy
  them with gold; each gives a **permanent passive** (Stuyvesant: Custom House bypasses
  boycotts/taxes; Fugger: lifts boycott; Lafayet: French troops; Galbaism… many) or a one-shot.
- **Ours:** static per-empire traits (`goods.ts EMPIRE_TRAITS`) + 6-tech insight tree.
- **Status: 🔀/🟡**
- **Adopt — the bridge is cheap:** a **Founders pool bought with insight** (our existing
  currency), 8–12 historical figures, each one permanent effect, some era-gated. Effects
  already in our vocabulary: duty cuts, embargo lift, +movement, +tribal stance, granary
  everywhere, bells/faith boost. Reuses `buyTech` machinery; biggest flavor-per-effort win
  in this doc.

## 8. Units & combat

- **Original:** settlers, rangers (fast scouts), traders, artisans (build), pioneers (road!),
  soldiers/dragoons (cost gold **+ equipment**: muskets/horses consumed), veterans gain
  attack/def points; sea units: caravel/carrack/merchantman/frigate/man-o-war; city attacks
  need defense value; walls reduce bombardment. Rivers appear on the map (navigation into
  estuaries; **verify exact water-passability** in FreeCol).
- **Ours:** settler/militia/frigate, tile-collision combat, escort/intercept/bombard, fordable
  rivers, sea-only frigates (per user decision).
- **Status: 🟡**
- **Adopt:**
  1. **Equipment costs for soldiers**: Militia stays gold-only; add **Soldier** unit = gold +
     1 Musket from stock (chains §3!). Creates a war-economy loop: musket manufactory feeds your army.
  2. Ranger as a scout unit (reveal radius 5 — cheap win with our fog system: exploration!).
  3. Veteran promotions (+1 attack after kills) — tiny, adds battle texture.

## 9. Transport, roads, logistics

- **Original:** roads connect colonies; units get movement bonus on roads; wagon trails
  (pioneers build); overland trade is *impossible* except roads to ports; carriers sail
  coasts + **rivers reach some inland sites**; Custom House raises per-turn sales.
- **Ours:** dock on any waterfront (sea or river — matches original spirit!), wagondepot+toll,
  12-cargo cap, frigate patrols.
- **Status: 🟡** — our wagons ≈ their roads, but static.
- **Adopt:** **road segments**: build improvement "road" between two of your towns over
  ~3 seasons; wagons on the route lose no toll and units move cheaper on it. (Medium effort,
  changes settlement geometry.) Verify river-sailing nuance in FreeCol before touching docks.

## 10. Victory

- **Original:** declare independence (needs bells) → **win the revolution war** against the
  REF (survive waves; drive redcoats out); or refuse independence and just dominate the
  continent (conquest of other colonies). No "wealth"/"faith" victory.
- **Ours:** independence (loyalty), faith, wealth, expelled.
- **Status: 🔀** our three races are intentional. The original's post-declaration **war phase**
  is its crown jewel and we lack it: after declaring, periodic REF landings until you either
  repel them all (win) or get occupied (lose). Our garrison/occupation code is 80% of the way
  there — make declaring independence start a REF cadence instead of an instant win.

## 11. Misc systems noted, not mapped

- Fishing (ocean food), Treasure/Conquistador silver rushes (Spain flavor — pairs with our
  Spain +silver trait), difficulty levels, plow tech (maps to our `fallow`), Custom House,
  education of colonists (our `press` tech is adjacent), native smallpox depopulation
  aftermath (our `lost%` display + hunts).

---

## Implementation backlog (fidelity × effort)

| # | Item | Section | Effort | Why first |
|---|---|---|---|---|
| 1 | Market drift model (rise/fall/attrition, bid/ask) | §2 | ✅ done | core loop of the whole game; replaces our fakest system |
| 2 | Manufacturing chains (weaver/tannery/smithy/refinery/armory, trade goods, cotton) | §3 | ✅ done | turns trade into an engine; seasons give it rhythm |
| 3 | Founders-for-insight pool | §7 | ✅ done | max flavor/effort; reuses research machinery |
| 4 | Native demand cycles + land purchase + skill gifts | §5 | ✅ done | makes tribes a real counterpart, not a passive resource |
| 5 | Tax ladder + duty-on-arrival + trade severance + REF funded by taxes paid + 48-season war phase | §6/§10 | ✅ done | the original's endgame drama |
| 6 | Storage caps + spoilage | §4 | ✅ done | forces the shipping cadence |
| 7 | Soldier (musket equipment) + ranger (scout) + veterans | §8 | ✅ done | war economy + exploration synergy |
| 8 | Roads (lane between towns: toll-free wagons, cheap walking) | §9 | ✅ done | completes the wagon economy |

All eight backlog items are implemented (2026-11-17). Follow-up pass (same day): specialists-lite
(§4: farmers/artisans/traders assigned from pop against terrain+building slots — jobSlots/jobWorkers
in sim.ts), hotseat 2P (s.humans rotation + s.crownSubject so crown machinery tracks the first colony;
per-owner exportValBy + Victory.owner),, Custom House season quota (§9: £100/£200 landed per town per season, SALES_CAP),
roads drawn on the map, fog/sound settings, onboarding hints, and colony codes (src/replay.ts:
seed + action log = byte-exact replay — the async-multiplayer foundation). Remaining open verification notes:
river navigation rules and REF spawn cadence were matched to FreeCol qualitatively, not
constant-for-constant; the market formula (§2) is validated against `MarketData.java`.

License guardrail: FreeCol is GPL-2.0 and Fandom tables are CC-BY-SA — facts and numbers
migrate to our code (re-expressed as our own constants with notes in this doc); no FreeCol
code, XML files, or copied blobs enter this repo.
