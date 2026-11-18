import { createGame, eventChoice } from '../src/sim/state';
import { endTurn, foundTown, buildImprovement, trainUnit, payFine } from '../src/sim/sim';

function run(seed: number, opts: { defend: boolean; fine: boolean; turns: number }) {
  const s = createGame(seed);
  const first = s.units.find((u) => u.owner === 'england')!;
  foundTown(s, 'england', first.id);
  for (let i = 0; i < opts.turns && !s.victory; i++) {
    endTurn(s);
    while (s.pendingEvents.length > 0) {
      const ev = s.pendingEvents[0];
      const idx = ev.kind === 'tax' ? 1 : ev.kind === 'visit' ? 1 : ev.kind === 'troops' ? 1 : 0;
      if (!eventChoice(s, ev.id, idx)) break;
    }
    if (s.garrison && opts.defend) {
      const t = s.towns.find((x) => x.id === s.garrison!.targetTownId)!;
      if (!t.construction && !t.improvements.includes('fort')) buildImprovement(s, 'england', t.id, 'fort');
      const mil = s.units.filter((u) => u.kind === 'militia' && u.q === t.q && u.r === t.r).length;
      if (mil < 3) trainUnit(s, 'england', t.id, 'militia');
    }
    if (opts.fine && s.occupations.length > 0 && s.treasury.england >= 100) {
      payFine(s, s.occupations[0].townId);
    }
  }
  const arc = s.log.filter((l) => /Crown Sends|Repelled|Occupy|fine of|withdraws/i.test(l)).reverse();
  return { s, arc };
}

// A: defend (fort + militia), no fines — expect repels
{
  const { s, arc } = run(1607, { defend: true, fine: false, turns: 100 });
  console.log(`A(defend): ${s.year} victory=${JSON.stringify(s.victory)} taken=${s.occupationsTaken}`);
  console.log('  ' + arc.join(' | '));
}
// B: undefended, pay fines — expect 3 occupations (defeated by 3rd)
{
  const { s, arc } = run(1607, { defend: false, fine: true, turns: 120 });
  console.log(`B(fines):  ${s.year} victory=${JSON.stringify(s.victory)} taken=${s.occupationsTaken}`);
  console.log('  ' + arc.join(' | '));
}
// C: undefended, no fines — same, defeat, no money spent
{
  const { s, arc } = run(1607, { defend: false, fine: false, turns: 120 });
  console.log(`C(nothing): ${s.year} victory=${JSON.stringify(s.victory)} taken=${s.occupationsTaken} £=${Math.round(s.treasury.england)}`);
  console.log('  ' + arc.join(' | '));
}
