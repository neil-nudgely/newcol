import type { Era } from './goods';

export interface FounderDef {
  id: string;
  name: string;
  cost: number;
  era: Era;
  desc: string;
}

/** Historical notables who cross the water in answer to the colony's growing reputation. */
export const FOUNDERS: FounderDef[] = [
  { id: 'columbus', name: 'Columbus', cost: 10, era: 1, desc: 'Old ocean eyes: your settlers and soldiers march one further tile each season.' },
  { id: 'harriot', name: 'Thomas Harriot', cost: 12, era: 1, desc: 'The natural philosopher: every fed town gathers a further quarter of insight.' },
  { id: 'oglethorpe', name: 'General Oglethorpe', cost: 14, era: 1, desc: 'A just governor pleases the people: every town grows faster.' },
  { id: 'franklin', name: 'Benjamin Franklin', cost: 14, era: 1, desc: 'The postal rings his gifts dearer: presents to the nations cost £10 and warm them further.' },
  { id: 'stuyvesant', name: 'Peter Stuyvesant', cost: 16, era: 1, desc: 'The Custom House counts every crate twice honestly: the wagon toll is halved.' },
  { id: 'shipwright', name: 'The Naval Agent', cost: 14, era: 2, desc: 'Keels laid in the dry yard: frigates cost £15 less.' },
  { id: 'montcalm', name: 'Chevalier Montcalm', cost: 16, era: 2, desc: 'Sappists and stone: forts rise £25 cheaper.' },
  { id: 'frontenac', name: 'Frontenac', cost: 16, era: 2, desc: 'The governor-trader: your exports fetch a further 10% in Europe.' },
  { id: 'lafayette', name: 'Marquis de Lafayette', cost: 18, era: 2, desc: 'Drill in the streets: +2 to the defence of every town of yours.' },
  { id: 'paine', name: 'Thomas Paine', cost: 20, era: 2, desc: 'Common Sense: the Meeting House loosens the Crown\u2019s grip half again as fast.' },
];
