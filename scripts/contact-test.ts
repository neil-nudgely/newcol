import { createGame, eventChoice } from '../src/sim/state';
import { endTurn, foundTown } from '../src/sim/sim';
import { hexDist } from '../src/sim/hex';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); cond ? pass++ : fail++; };
const resolve = (s: any, idxFor?: (k: string) => number, include?: (k: string) => boolean) => {
  let guard = 0;
  while (s.pendingEvents.length > 0 && guard++ < 20) {
    const e = s.pendingEvents[0];
    if (include && !include(e.kind)) break;
    const i = idxFor ? idxFor(e.kind) : 0;
    if (!eventChoice(s, e.id, i)) break;
  }
};

function setup(): { s: any; tri: any } | null {
  const s = createGame(1607, 'england');
  const u = s.units.find((x: any) => x.owner === 'england');
  const tri = s.tribes[0];
  let spot: any = null;
  for (const t of s.tiles) {
    if (t.terrain !== 'grass' && t.terrain !== 'forest') continue;
    const d = hexDist(t.q, t.r, tri.q, tri.r);
    if (d > tri.claimRadius - 1 && d <= tri.claimRadius + 1) { spot = t; break; }
  }
  if (!spot) return null;
  u.q = spot.q; u.r = spot.r;
  foundTown(s, 'england', u.id);
  const town = s.towns[0];
  return hexDist(town.q, town.r, tri.q, tri.r) <= tri.claimRadius + 1 ? { s, tri } : null;
}

// 1. Contact fires, defers a follow-up (no instant plague)
{
  const r = setup();
  if (!r) { console.log('SKIP: no tribe near founding spot'); }
  else {
    const contact = r.s.pendingEvents.find((e: any) => e.kind === 'contact');
    check('contact event fires on founding near a tribe', !!contact);
    check('no instant plague (deferred)', !r.s.pendingEvents.find((e: any) => e.kind === 'plague'));
    check('contact narrative mentions the braves', /braves/.test(contact?.body ?? ''));
    resolve(r.s, (k: string) => 0); // greet
    check('contact schedules a follow-up', r.tri.followUpIn === 2 && r.tri.followUp !== null);
    check('follow-up is one of plague/caravan/council', ['plague', 'caravan', 'council'].includes(r.tri.followUp));
  }
}

// 2. Each follow-up type plays out correctly
for (const kind of ['plague', 'caravan', 'council'] as const) {
  const r = setup();
  if (!r) { console.log(`SKIP ${kind}`); continue; }
  resolve(r.s, (k: string) => 0);
  r.tri.followUp = kind;
  r.tri.followUpIn = 2;
  endTurn(r.s); resolve(r.s, (k: string) => (k === 'tax' ? 1 : 0));
  endTurn(r.s); resolve(r.s, (k: string) => (k === 'tax' ? 1 : 0), (k: string) => k !== kind);
  const ev = r.s.pendingEvents.find((e: any) => e.kind === kind);
  check(`${kind}: event fires after the meeting`, !!ev);
  const popBefore = r.tri.pop;
  const treasBefore = r.s.treasury['england'];
  const tradeBefore = r.tri.trade['england'];
  const stanceBefore = r.tri.stance['england'] ?? 0;
  eventChoice(r.s, ev.id, kind === 'council' ? 0 : 0);
  if (kind === 'plague') check('plague: takes the tribe\u2019s people', r.tri.pop < popBefore);
  if (kind === 'caravan') { check('caravan: opens trade', r.tri.trade['england'] === true && tradeBefore === false); check('caravan: pays a bounty', r.s.treasury['england'] > treasBefore); }
  if (kind === 'council') check('council: tribute raises standing', (r.tri.stance['england'] ?? 0) > stanceBefore);
  check(`${kind}: follow-up cleared`, r.tri.followUp === null && r.tri.followUpIn === null);
}

console.log(`\nFIRST-CONTACT VARIETY TEST: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
