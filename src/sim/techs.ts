import type { Era } from './goods';

export interface TechDef {
  id: string;
  name: string;
  cost: number;
  era: Era;
  desc: string;
}

export const TECHS: TechDef[] = [
  { id: 'fallow', name: 'Crop Rotation', cost: 8, era: 1, desc: 'Worn fields rested in turn: +1 wheat from every town.' },
  { id: 'adze', name: 'Iron Adzes', cost: 8, era: 1, desc: 'Better axes from the forges: +1 lumber from every town.' },
  { id: 'charts', name: 'Maritime Charts', cost: 12, era: 1, desc: 'Sounding lines and compass roses: your frigates sail 6 tiles a turn instead of 4.' },
  { id: 'press', name: 'The Printing Press', cost: 15, era: 2, desc: 'Pamphlets spread like wildfire: loyalty to the Crown falls a further 0.5 each turn.' },
  { id: 'powder', name: 'Fine Gunpowder', cost: 15, era: 2, desc: 'Cotton-fine powder burns true: artillery may be raised in the Age of Trade.' },
  { id: 'refining', name: 'The Refining Works', cost: 20, era: 2, desc: 'Assays and crucibles: +1 silver and +1 iron from the lodes in every town.' },
];
