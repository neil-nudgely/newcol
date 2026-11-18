# NEWCOL — a Colonization remake

A web remake of Sid Meier's *Colonization* (1994): settle a coastal chartered colony,
trade with (and exploit) the nations already here, ship goods through a Europe market
that drifts with your own dumping, and break free of an empire whose duty ladder —
and whose invading expeditions — your own taxes paid for.

Built with TypeScript + Vite + Three.js. The simulation is fully deterministic off
`GameState.rng` (a seeded PRNG with a call counter), for future async multiplayer.

## Run

```
npm install
npm run dev      # http://localhost:5173/?seed=1607
```

## Test

```
npm test               # typecheck + all node sim suites
npm run test:browser   # playwright walkthrough (needs `npm run dev` running)
npm run sweep          # multi-seed balance sweep (bot games on 10 seeds)
npm run build          # tsc --noEmit && vite build
```

Sim suites live in `scripts/*-test.ts` and run headless via `scripts/test-all.mjs`.
`scripts/smoke.ts` plays a full game with the scripted bot; `scripts/balance-analysis.ts`
reports race pacing.

## How a colony works (player-facing summary)

- **Time**: one turn per season, four seasons per year (Spring…Winter). Goods have
  harvest seasons — lumber in spring, spices in summer, sugar/tobacco/wheat in autumn,
  furs in winter. Mines run year-round.
- **Europe market**: each empire has its own market. Your deliveries flood it and push
  your sell price down; an unworked market drifts short and prices rise above base.
  Buying costs a spread over selling. Prices move at most £1 a season.
- **Manufacturing**: workshops convert 2 raw goods into 1 premium good (cotton→cloth,
  furs→coats, iron→tools→muskets, sugar→rum, tobacco→cigars). Muskets arm line soldiers.
- **The land**: fog of war (rangers see 5), rivers you can dock at (cargo only), roads
  between your towns that end wagon tolls, and storehouses that spoil a surplus over 30.
- **The nations**: each wants cyclical demand lists; fulfilling them earns gold, standing,
  and occasionally a skill (trapping/planting/scouting). Deeds of £60 end a land grievance.
- **Disease**: first contact can seed epidemics in either population; quarantine (£20)
  and survivors' immunity apply to both.
- **Specialists**: your people fill job slots the ground and buildings enable — farmers
  (food), artisans (+1 output per workshop), traders (+5% per trader on shiploads).
- **Custom House**: a town may land £100 of goods on Europe a season; a Custom House lifts it to £200.
- **The Crown**: duty starts at 10% and the King's ladder rises every twelve years.
  Accept, buy the peace off cheaply, or sever trade — declare independence and survive
  48 seasons of expeditions funded by the taxes you already paid.
- **Victory**: independence (win the war), 75 missions of the Faith, or £11,000 of
  export value. Lose the war and you're expelled.

## Design notes

The ⚙ settings carry a **colony code**: every action of the game, from the seed out. Paste it
into another browser to replay the colony to the exact same moment — deterministic cores make
that free, and it is the ground under future async multiplayer.

`docs/original-mechanics.md` is a clean-room mapping of the original's systems (researched
from FreeCol's GPL code and the Civilization wikis — facts only, no code copied) against
our implementation, including the finished 8-item fidelity backlog.

## Layout

    src/sim/       deterministic game core (state, sim, goods, techs, founders, ai-ish)
    src/render/    Three.js map scene (fog, terrain, rivers, ships, units)
    src/ui/        panels, modals, HUD
    scripts/       headless test suites, smoke bot, balance tools
