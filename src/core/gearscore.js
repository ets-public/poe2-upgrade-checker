'use strict';

// Gear score: rates an item 0-100 for how useful it is to YOUR build, by slot.
// Each build profile lists the stats it wants, how important each is (0-10)
// and what counts as an excellent roll ("cap"). An item scores
//   sum(importance x roll quality) / (the best an item in that slot could get)
// so a perfect item for your build is ~100, and stats your build doesn't use
// add nothing (they're listed as "wasted").

const { statSources } = require('./trade');

// imp / cap can be a number or { Slot: n, default: n }.
const pick = (v, slot) => (v && typeof v === 'object' ? (v[slot] != null ? v[slot] : (v.default != null ? v.default : 0)) : v || 0);

const RES = (el) => ({ test: new RegExp(`^#% to ${el} Resistance$`), label: `${el} res`, key: `#% to ${el} Resistance`, res: el, imp: { Weapon: 0, Jewel: 0, default: 4 }, cap: 45 });

// used when you haven't picked a profile (Path of Building usually picks one for you on import)
const DEFAULT_BUILD = 'life-res';
// mods that only work some of the time ("…if you've Hit Recently", "while…", "per Power Charge"); not "per second"
const COND = /\b(if you've|if you have|while|when|recently)\b|\bper (?!second)/i;

const BUILDS = {
  'djinn-varashta': {
    name: 'Minion summoner (ES) – e.g. Disciple of Varashta Djinns',
    summary: 'Minion skill levels and Spirit first, then ally/minion damage, Energy Shield, resistances; movement speed on boots.',
    // imp is per slot; 0 (default) means the stat can't roll there, so it
    // doesn't count towards that slot's "perfect item".
    stats: [
      { test: /^# to Level of all Minion Skills$/, label: 'Minion skill levels', key: '# to Level of all Minion Skills', imp: { Weapon: 10, Offhand: 10, Amulet: 10, Helmet: 9, default: 0 }, cap: { Weapon: 4, Offhand: 3, Amulet: 3, default: 2 } },
      { test: /^\[Base\] Spirit$/, label: 'Spirit (base)', imp: { Weapon: 8, default: 0 }, cap: 160 },
      { test: /^# to Spirit$/, label: 'Spirit', key: '# to Spirit', imp: { 'Body Armour': 8, Amulet: 8, Weapon: 7, default: 0 }, cap: 60 },
      { test: /^Allies in your Presence deal #% increased Damage$/, label: 'Ally damage', key: 'Allies in your Presence deal #% increased Damage', imp: { Weapon: 8, default: 0 }, cap: 90 },
      { test: /^Allies in your Presence Gain #% of Damage as Extra/, label: 'Ally extra damage', imp: { Weapon: 6, default: 0 }, cap: 15 },
      { test: /^Minions deal #% increased Damage/, label: 'Minion damage', key: 'Minions deal #% increased Damage', imp: { Ring: 7, Weapon: 6, Offhand: 6, Jewel: 7, default: 0 }, cap: { Ring: 25, Jewel: 15, default: 45 } },
      { test: /^(Allies in your Presence|Minions) have #% increased Critical (Hit Chance|Damage Bonus)$/, label: 'Minion crit', imp: { Weapon: 5, Ring: 5, Jewel: 5, default: 0 }, cap: { Jewel: 20, default: 40 } },
      { test: /^(Allies in your Presence|Minions|You and Allies in your Presence) have #% increased (Attack Speed|Cast Speed|Attack and Cast Speed)$/, label: 'Minion speed', imp: { Weapon: 5, Ring: 4, Amulet: 4, Jewel: 5, default: 0 }, cap: { Jewel: 8, default: 20 } },
      { test: /^(Allies in your Presence|Minions) have #% to all Elemental Resistances$/, label: 'Minion res', imp: { Weapon: 2, default: 0 }, cap: 16 },
      { test: /^Minions have #% increased maximum Life$|^Minions gain #% of their maximum Life as Extra maximum Energy Shield$/, label: 'Minion defence', imp: { Weapon: 2, Offhand: 2, Jewel: 2, default: 0 }, cap: { Jewel: 10, default: 30 } },
      { test: /^#% increased Spirit Reservation Efficiency of Skills$/, label: 'Spirit efficiency', imp: { Amulet: 5, default: 0 }, cap: 15 },
      { test: /^\[Base\] Energy Shield$/, label: 'Energy Shield', imp: { 'Body Armour': 10, Helmet: 9, Gloves: 8, Boots: 7, Offhand: 7, default: 0 }, cap: { 'Body Armour': 1000, Helmet: 550, Gloves: 350, Boots: 400, Offhand: 350, default: 1 } },
      { test: /^\[Base\] Armour$/, label: 'Armour', imp: { 'Body Armour': 2, default: 0 }, cap: 800 },
      // flat ES on armour is local (already in [Base]); on jewellery it's global
      { test: /^# to maximum Energy Shield$/, label: 'Energy Shield', key: '# to maximum Energy Shield', imp: { Amulet: 6, Ring: 5, Belt: 4, default: 0 }, cap: 60 },
      { test: /^#% increased maximum Energy Shield$/, label: '% Energy Shield', key: '#% increased maximum Energy Shield', imp: { Amulet: 7, Jewel: 7, default: 0 }, cap: { Jewel: 12, default: 25 } },
      { test: /^Gain #% of maximum (Life|Mana) as Extra maximum Energy Shield$/, label: 'Extra ES', imp: { 'Body Armour': 5, default: 0 }, cap: 15 },
      { test: /^# to maximum Life$/, label: 'Life', key: '# to maximum Life', imp: { Weapon: 0, Jewel: 0, default: 4 }, cap: 100 },
      { test: /^# to maximum Mana$/, label: 'Mana', key: '# to maximum Mana', imp: { Jewel: 0, default: 3 }, cap: 150 },
      RES('Fire'), RES('Cold'), RES('Lightning'),
      { test: /^#% to Chaos Resistance$/, label: 'Chaos res', key: '#% to Chaos Resistance', res: 'Chaos', imp: { Weapon: 0, Jewel: 0, default: 4 }, cap: 30 },
      { test: /^# to Intelligence$/, label: 'Intelligence', key: '# to Intelligence', imp: { Jewel: 1, default: 3 }, cap: { Jewel: 12, default: 35 } },
      { test: /^# to (Strength|Dexterity)$/, label: 'Str/Dex', imp: { Jewel: 0, default: 1.5 }, cap: 35 },
      { test: /^#% increased Movement Speed$/, label: 'Movement speed', key: '#% increased Movement Speed', imp: { Boots: 10, default: 0 }, cap: 35 },
      { test: /^#% increased Cast Speed$/, label: 'Cast speed', key: '#% increased Cast Speed', imp: { Ring: 3, Amulet: 3, Offhand: 3, Jewel: 2, default: 0 }, cap: { Jewel: 6, default: 25 } },
      { test: /^#% increased Energy Shield Recharge Rate$|^#% faster start of Energy Shield Recharge$/, label: 'ES recharge', imp: { Offhand: 2, 'Body Armour': 2, Helmet: 2, Belt: 2, Amulet: 2, Jewel: 3, default: 0 }, cap: { Jewel: 25, default: 40 } },
      { test: /^#% increased Mana Regeneration Rate$/, label: 'Mana regen', imp: { Ring: 1.5, Amulet: 1.5, Offhand: 1.5, default: 0 }, cap: 40 },
      { test: /^# Life Regeneration per second$/, label: 'Life regen', imp: { Jewel: 0, default: 1 }, cap: 15 },
      { test: /^#% increased Rarity of Items found$/, label: 'Rarity', imp: { Ring: 1.5, Amulet: 1.5, Helmet: 1.5, Gloves: 1.5, Boots: 1.5, default: 0 }, cap: 30 },
    ],
  },
};

const LOCAL_DEFENCE = /^#% increased (Armour|Evasion Rating|Evasion|Energy Shield|Armour and Evasion|Armour and Energy Shield|Evasion and Energy Shield|Armour, Evasion and Energy Shield)$|^# to (maximum Energy Shield|Armour|Evasion Rating)$/;
const LOCAL_DPS = /^#% increased (Attack Speed|Physical Damage)$|Adds # to # \w+ Damage$/;
// Two general-purpose profiles for other characters.
const ES = { test: /^\[Base\] Energy Shield$/, label: 'Energy Shield', imp: { 'Body Armour': 10, Helmet: 9, Gloves: 8, Boots: 7, Offhand: 7, default: 0 }, cap: { 'Body Armour': 1000, Helmet: 550, Gloves: 350, Boots: 400, Offhand: 350, default: 1 } };
const AR = { test: /^\[Base\] (Armour|Evasion Rating)$/, label: 'Armour / Evasion', imp: { 'Body Armour': 10, Helmet: 8, Gloves: 7, Boots: 6, Offhand: 7, default: 0 }, cap: { 'Body Armour': 1200, Helmet: 600, Gloves: 400, Boots: 450, Offhand: 450, default: 1 } };
const COMMON = (lifeImp) => [
  { test: /^# to maximum Life$/, label: 'Life', key: '# to maximum Life', imp: { Weapon: 0, Jewel: 0, default: lifeImp }, cap: 100 },
  { test: /^#% to Fire Resistance$/, label: 'Fire res', key: '#% to Fire Resistance', res: 'Fire', imp: { Weapon: 0, Jewel: 0, default: 5 }, cap: 45 },
  { test: /^#% to Cold Resistance$/, label: 'Cold res', key: '#% to Cold Resistance', res: 'Cold', imp: { Weapon: 0, Jewel: 0, default: 5 }, cap: 45 },
  { test: /^#% to Lightning Resistance$/, label: 'Lightning res', key: '#% to Lightning Resistance', res: 'Lightning', imp: { Weapon: 0, Jewel: 0, default: 5 }, cap: 45 },
  { test: /^#% to Chaos Resistance$/, label: 'Chaos res', key: '#% to Chaos Resistance', res: 'Chaos', imp: { Weapon: 0, Jewel: 0, default: 3 }, cap: 30 },
  { test: /^#% increased Movement Speed$/, label: 'Movement speed', key: '#% increased Movement Speed', imp: { Boots: 10, default: 0 }, cap: 35 },
  { test: /^# to (Strength|Dexterity|Intelligence)$/, label: 'Attributes', imp: { Jewel: 0, default: 2 }, cap: 35 },
  { test: /^#% increased Rarity of Items found$/, label: 'Rarity', imp: { Ring: 1.5, Amulet: 1.5, Helmet: 1.5, Gloves: 1.5, Boots: 1.5, default: 0 }, cap: 30 },
];
// wands and staves: "Gain #% of Damage as Extra Fire Damage" (up to 30 on a wand, 60 on a staff)
const EXTRA_ELE = { test: /^Gain #% of Damage as Extra (Fire|Cold|Lightning) Damage$/, label: 'Damage as extra', imp: { Weapon: 6, default: 0 }, cap: 45 };
BUILDS['es-caster'] = {
  name: 'Energy Shield spellcaster (generic)',
  summary: 'Spell skill levels, spell/elemental damage, cast speed, crit and extra damage on weapons; Energy Shield and resistances on armour.',
  stats: [
    { test: /^# to Level of all (Spell|Fire Spell|Cold Spell|Lightning Spell|Chaos Spell) Skills$/, label: 'Spell skill levels', key: '# to Level of all Spell Skills', imp: { Weapon: 10, Offhand: 9, Amulet: 9, default: 0 }, cap: { Weapon: 5, default: 3 } },
    { test: /^#% increased (Spell|Fire|Cold|Lightning|Chaos|Elemental) Damage$/, label: 'Spell damage', key: '#% increased Spell Damage', imp: { Weapon: 9, Offhand: 8, Amulet: 5, Ring: 4, Jewel: 7, default: 0 }, cap: { Jewel: 15, Ring: 30, default: 100 } },
    { test: /^#% increased Cast Speed$/, label: 'Cast speed', key: '#% increased Cast Speed', imp: { Weapon: 7, Ring: 5, Amulet: 5, Jewel: 4, default: 0 }, cap: { Jewel: 6, default: 25 } },
    { test: /^#% increased Critical (Hit Chance|Damage Bonus)( for Spells)?$/, label: 'Crit', imp: { Weapon: 6, Offhand: 5, Amulet: 4, Jewel: 4, Helmet: 3, default: 0 }, cap: { Jewel: 15, default: 60 } },
    EXTRA_ELE,
    ES,
    { test: /^#% increased maximum Energy Shield$/, label: '% Energy Shield', key: '#% increased maximum Energy Shield', imp: { Amulet: 7, Jewel: 7, default: 0 }, cap: { Jewel: 12, default: 25 } },
    { test: /^# to maximum Energy Shield$/, label: 'Energy Shield', key: '# to maximum Energy Shield', imp: { Amulet: 6, Ring: 5, Belt: 4, default: 0 }, cap: 60 },
    { test: /^# to maximum Mana$/, label: 'Mana', key: '# to maximum Mana', imp: { Jewel: 0, default: 3 }, cap: 150 },
    { test: /^# to Spirit$/, label: 'Spirit', key: '# to Spirit', imp: { 'Body Armour': 5, Amulet: 5, default: 0 }, cap: 60 },
    ...COMMON(3),
  ],
};
BUILDS['life-res'] = {
  name: 'Life & resistances (any build)',
  summary: 'A safe all-rounder: life, resistances, Armour/Evasion and movement speed. Weapons: damage per second.',
  stats: [
    { test: /^\[Weapon\] Total DPS$/, label: 'Weapon DPS', imp: { Weapon: 10, default: 0 }, cap: 400 },
    AR, ES,
    ...COMMON(7),
    { test: /^#% increased (Attack|Cast) Speed$/, label: 'Speed', imp: { Weapon: 4, Ring: 3, Amulet: 3, Gloves: 3, default: 0 }, cap: 20 },
  ],
};

// ---------- profiles for every kind of build: what it does x how it stays alive ----------
// The three profiles above are three of these pairs (minions/ES, spells/ES, any/life); the rest are
// put together from the parts below. Mod texts and top rolls are PoE2's (Path of Building 2's mod data).
const ARM_B = { test: /^\[Base\] Armour$/, label: 'Armour', imp: { 'Body Armour': 10, Helmet: 8, Gloves: 7, Boots: 6, Offhand: 7, default: 0 }, cap: { 'Body Armour': 1200, Helmet: 600, Gloves: 400, Boots: 450, Offhand: 450, default: 1 } };
const EVA_B = { test: /^\[Base\] Evasion Rating$/, label: 'Evasion', imp: { 'Body Armour': 10, Helmet: 8, Gloves: 7, Boots: 6, Offhand: 7, default: 0 }, cap: { 'Body Armour': 1200, Helmet: 600, Gloves: 400, Boots: 450, Offhand: 450, default: 1 } };
// a hybrid base has about half of each: its excellent roll is lower
const half = (e) => ({ ...e, cap: Object.fromEntries(Object.entries(e.cap).map(([k, v]) => [k, k === 'default' ? v : Math.round(v * 0.55)])) });
const LIFE = (imp) => ({ test: /^# to maximum Life$/, label: 'Life', key: '# to maximum Life', imp: { Weapon: 0, Jewel: 0, default: imp }, cap: 100 });
const LIFE_PCT = { test: /^#% increased maximum Life$/, label: '% Life', key: '#% increased maximum Life', imp: { Amulet: 5, default: 0 }, cap: 8 };
const ARM_X = [
  { test: /^#% increased Armour$/, label: '% Armour', key: '#% increased Armour', imp: { Amulet: 3, Jewel: 3, default: 0 }, cap: { Jewel: 20, default: 50 } },
  { test: /^# to Armour$/, label: 'Flat Armour', key: '# to Armour', imp: { Belt: 3, default: 0 }, cap: 350 },
  { test: /^#% of Armour also applies to Elemental Damage$/, label: 'Armour vs elemental', imp: { 'Body Armour': 4, Helmet: 3, Gloves: 3, Boots: 3, Offhand: 3, default: 0 }, cap: 50 },
];
const EVA_X = [
  { test: /^#% increased Evasion Rating$/, label: '% Evasion', key: '#% increased Evasion Rating', imp: { Amulet: 3, Jewel: 3, default: 0 }, cap: { Jewel: 20, default: 50 } },
  { test: /^# to Evasion Rating$/, label: 'Flat Evasion', key: '# to Evasion Rating', imp: { Ring: 2, default: 0 }, cap: 230 },
  { test: /^Gain Deflection Rating equal to #% of Evasion Rating$/, label: 'Deflection', imp: { 'Body Armour': 4, Helmet: 3, Gloves: 3, Boots: 3, Offhand: 3, default: 0 }, cap: 26 },
];
const ES_X = [
  { test: /^#% increased maximum Energy Shield$/, label: '% Energy Shield', key: '#% increased maximum Energy Shield', imp: { Amulet: 7, Jewel: 7, default: 0 }, cap: { Jewel: 12, default: 25 } },
  { test: /^# to maximum Energy Shield$/, label: 'Flat Energy Shield', key: '# to maximum Energy Shield', imp: { Amulet: 6, Ring: 5, Belt: 4, default: 0 }, cap: 60 },
  { test: /^#% increased Energy Shield Recharge Rate$|^#% faster start of Energy Shield Recharge$/, label: 'ES recharge', imp: { 'Body Armour': 2, Helmet: 2, Offhand: 2, Jewel: 2, default: 0 }, cap: { Jewel: 25, default: 30 } },
];
const RECOUP = { test: /^#% of Damage taken Recouped as Life$/, label: 'Life recoup', imp: { Amulet: 2, default: 0 }, cap: 24 };

const DEF = {
  life: { name: 'Life & resistances (any)', summary: 'life, resistances and whatever Armour, Evasion or Energy Shield the armour has.', stats: [AR, ES, LIFE(7), LIFE_PCT, RECOUP] },
  'life-ar': { name: 'Life & Armour', summary: 'life, Armour (and Armour against elemental hits), resistances.', stats: [ARM_B, LIFE(7), LIFE_PCT, ...ARM_X, RECOUP] },
  'life-ev': { name: 'Life & Evasion', summary: 'life, Evasion and Deflection, resistances.', stats: [EVA_B, LIFE(7), LIFE_PCT, ...EVA_X, RECOUP] },
  'life-arev': { name: 'Life, Armour & Evasion', summary: 'life, Armour and Evasion bases, resistances.', stats: [half(ARM_B), half(EVA_B), LIFE(7), LIFE_PCT, ...ARM_X, ...EVA_X, RECOUP] },
  es: { name: 'Energy Shield', summary: 'Energy Shield bases, % and flat Energy Shield, resistances; a little life.', stats: [ES, ...ES_X, LIFE(3)] },
  'ev-es': { name: 'Evasion & Energy Shield', summary: 'Evasion and Energy Shield bases, Deflection, resistances; some life.', stats: [half(EVA_B), half(ES), ...ES_X, ...EVA_X, LIFE(4)] },
  'ar-es': { name: 'Armour & Energy Shield', summary: 'Armour and Energy Shield bases, resistances; some life.', stats: [half(ARM_B), half(ES), ...ES_X, ...ARM_X, LIFE(4)] },
};

const WEAPON_DPS = { test: /^\[Weapon\] Total DPS$/, label: 'Weapon DPS', imp: { Weapon: 10, default: 0 }, cap: 450 };
const SPIRIT_BUFFS = { test: /^# to Spirit$/, label: 'Spirit', key: '# to Spirit', imp: { 'Body Armour': 4, Amulet: 4, default: 0 }, cap: 60 };
const MANA = (imp) => ({ test: /^# to maximum Mana$/, label: 'Mana', key: '# to maximum Mana', imp: { Jewel: 0, default: imp }, cap: 150 });
const ATTACK = (ranged) => [
  WEAPON_DPS,
  ranged
    ? { test: /^# to Level of all Projectile Skills$/, label: 'Projectile skill levels', key: '# to Level of all Projectile Skills', imp: { Weapon: 8, Amulet: 9, Offhand: 6, default: 0 }, cap: { Weapon: 5, Amulet: 3, default: 1 } }
    : { test: /^# to Level of all Melee Skills$/, label: 'Melee skill levels', key: '# to Level of all Melee Skills', imp: { Weapon: 8, Amulet: 9, Gloves: 7, default: 0 }, cap: { Weapon: 5, Amulet: 3, default: 2 } },
  { test: /^#% increased Attack Speed$/, label: 'Attack speed', key: '#% increased Attack Speed', imp: { Gloves: 6, Offhand: ranged ? 6 : 0, Jewel: 4, default: 0 }, cap: { Jewel: 4, default: 16 } },
  { test: /^#% increased Critical Hit Chance( for Attacks)?$/, label: 'Crit chance', imp: { Helmet: 4, Amulet: 5, Offhand: ranged ? 5 : 0, Jewel: 4, default: 0 }, cap: { Jewel: 16, default: 38 } },
  { test: /^#% increased Critical Damage Bonus( for Attack Damage)?$/, label: 'Crit damage', imp: { Gloves: 5, Amulet: 5, Offhand: ranged ? 5 : 0, Jewel: 4, default: 0 }, cap: { Jewel: 20, default: 38 } },
  { test: /^Adds # to # Physical Damage to Attacks$/, label: 'Added physical', key: 'Adds # to # Physical Damage to Attacks', imp: { Ring: 6, Gloves: 6, Offhand: ranged ? 6 : 0, default: 0 }, cap: 25 },
  { test: /^# to Accuracy Rating$/, label: 'Accuracy', key: '# to Accuracy Rating', imp: { Gloves: 4, Helmet: 3, Ring: 4, Amulet: 3, Offhand: ranged ? 4 : 0, default: 0 }, cap: { Ring: 450, Amulet: 450, default: 550 } },
  ranged
    ? { test: /^#% increased (Projectile|Attack) Damage$/, label: 'Projectile damage', imp: { Jewel: 6, default: 0 }, cap: 15 }
    : { test: /^#% increased (Melee|Attack) Damage$/, label: 'Melee damage', imp: { Jewel: 6, default: 0 }, cap: 15 },
  ...(ranged ? [{ test: /^#% increased Projectile Speed$/, label: 'Projectile speed', imp: { Offhand: 2, default: 0 }, cap: 46 }] : []),
  { test: /^Leech #% of Physical Attack Damage as Life$/, label: 'Life leech', imp: { Gloves: 3, Ring: 3, default: 0 }, cap: 8 },
  SPIRIT_BUFFS, MANA(1.5),
];
const OFF = {
  any: { name: 'Any build (weapon damage)', summary: 'Weapon damage per second and attack/cast speed', stats: [WEAPON_DPS, { test: /^#% increased (Attack|Cast) Speed$/, label: 'Speed', imp: { Weapon: 4, Ring: 3, Amulet: 3, Gloves: 3, default: 0 }, cap: 20 }, SPIRIT_BUFFS, MANA(2)] },
  melee: { name: 'Melee attacks', summary: 'Weapon damage, melee skill levels, attack speed, crit, accuracy and added physical damage', stats: ATTACK(false) },
  ranged: { name: 'Bows, crossbows & spears', summary: 'Weapon damage, projectile skill levels, attack speed, crit and accuracy (quivers too)', stats: ATTACK(true) },
  spell: { name: 'Spells', summary: 'Spell skill levels, spell/elemental damage, cast speed, crit and extra damage on wands and staves', stats: [...BUILDS['es-caster'].stats.slice(0, 5), { test: /^# to Spirit$/, label: 'Spirit', key: '# to Spirit', imp: { 'Body Armour': 5, Amulet: 5, default: 0 }, cap: 60 }, MANA(3), { test: /^#% increased Mana Regeneration Rate$/, label: 'Mana regen', imp: { Ring: 1.5, Amulet: 1.5, Offhand: 1.5, default: 0 }, cap: 69 }] },
  minion: { name: 'Minions', summary: 'Minion skill levels and Spirit first, then ally/minion damage, crit and speed', stats: [...BUILDS['djinn-varashta'].stats.slice(0, 11), MANA(3)] },
};
const SHARED = [
  { test: /^#% to Fire Resistance$/, label: 'Fire res', key: '#% to Fire Resistance', res: 'Fire', imp: { Weapon: 0, Jewel: 0, default: 5 }, cap: 45 },
  { test: /^#% to Cold Resistance$/, label: 'Cold res', key: '#% to Cold Resistance', res: 'Cold', imp: { Weapon: 0, Jewel: 0, default: 5 }, cap: 45 },
  { test: /^#% to Lightning Resistance$/, label: 'Lightning res', key: '#% to Lightning Resistance', res: 'Lightning', imp: { Weapon: 0, Jewel: 0, default: 5 }, cap: 45 },
  { test: /^#% to Chaos Resistance$/, label: 'Chaos res', key: '#% to Chaos Resistance', res: 'Chaos', imp: { Weapon: 0, Jewel: 0, default: 3 }, cap: 30 },
  { test: /^#% increased Movement Speed$/, label: 'Movement speed', key: '#% increased Movement Speed', imp: { Boots: 10, default: 0 }, cap: 35 },
  { test: /^# to (Strength|Dexterity|Intelligence)$/, label: 'Attributes', imp: { Jewel: 0, default: 2 }, cap: 35 },
  { test: /^# Life Regeneration per second$/, label: 'Life regen', imp: { Weapon: 0, Jewel: 0, default: 1 }, cap: 25 },
  { test: /^#% increased Rarity of Items found$/, label: 'Rarity', imp: { Ring: 1.5, Amulet: 1.5, Helmet: 1.5, Gloves: 1.5, Boots: 1.5, default: 0 }, cap: 19 },
];
// the three hand-made profiles are these pairs
const LEGACY = { 'djinn-varashta': ['minion', 'es'], 'es-caster': ['spell', 'es'], 'life-res': ['any', 'life'] };
const pairId = (off, def) => { const l = Object.entries(LEGACY).find(([, [o, d]]) => o === off && d === def); return l ? l[0] : `${off}/${def}`; };
function pairOf(id) {
  if (LEGACY[id]) return LEGACY[id];
  const m = /^(\w+)\/([\w-]+)$/.exec(String(id || ''));
  return m && OFF[m[1]] && DEF[m[2]] ? [m[1], m[2]] : null;
}
for (const [id, [o, d]] of Object.entries(LEGACY)) BUILDS[id].name = `${OFF[o].name} · ${DEF[d].name}`;
const made = {};
// a profile by id: one of the hand-made ones or "offence/defence"; undefined for anything else
function getBuild(id) {
  id = id || DEFAULT_BUILD;
  if (BUILDS[id]) return BUILDS[id];
  if (made[id]) return made[id];
  const p = pairOf(id);
  if (!p) return undefined;
  const [o, d] = p;
  const legacy = pairId(o, d);
  if (BUILDS[legacy]) return BUILDS[legacy];
  return (made[id] = { name: `${OFF[o].name} · ${DEF[d].name}`, summary: `${OFF[o].summary}; ${DEF[d].summary} Movement speed on boots.`, stats: [...OFF[o].stats, ...DEF[d].stats, ...SHARED] });
}
const buildParts = () => ({
  off: Object.entries(OFF).map(([id, x]) => ({ id, name: x.name })),
  def: Object.entries(DEF).map(([id, x]) => ({ id, name: x.name })),
});
function buildInfo(id) {
  if (id === 'off') return { id: 'off', custom: true };
  const b = getBuild(id); const p = pairOf(id || DEFAULT_BUILD);
  return b ? { id: p ? pairId(p[0], p[1]) : id || DEFAULT_BUILD, name: b.name, summary: b.summary, off: p && p[0], def: p && p[1] } : null;
}

// The profile that fits a Path of Building build: { dpsKey, kind: {attack, spell, melee, projectile, minion},
// weapon (base type of the main weapon), life, es, armour, evasion } -> a profile id
function fitProfile(b) {
  b = b || {};
  const k = b.kind || {};
  const w = String(b.weapon || '');
  let off;
  if (b.dpsKey === 'MinionDPS' || k.minion) off = 'minion';
  else if (k.spell && !k.attack) off = 'spell';
  else if (k.attack) off = k.projectile || /^(Bow|Crossbow)$/i.test(w) ? 'ranged' : 'melee';
  else if (/^(Wand|Staff)$/i.test(w)) off = 'spell';
  else off = 'any';
  const life = Number(b.life) || 0; const es = Number(b.es) || 0; const ar = Number(b.armour) || 0; const ev = Number(b.evasion) || 0;
  let def;
  if (es > life * 2) def = ev > es * 0.5 && ev >= ar ? 'ev-es' : ar > es * 0.5 ? 'ar-es' : 'es';
  else if (Math.max(ar, ev) < 300) def = 'life';
  else if (Math.min(ar, ev) > Math.max(ar, ev) * 0.4) def = 'life-arev';
  else def = ar > ev ? 'life-ar' : 'life-ev';
  // the hand-made Djinn profile is a minion build on Energy Shield; other minion builds on life get a life one
  return pairId(off, def);
}

const ARMOUR_SLOTS = ['Helmet', 'Body Armour', 'Gloves', 'Boots', 'Offhand'];
const { groupOf } = require('./slots');
const slotName = (s) => groupOf(s);

function grade(score) {
  if (score >= 85) return 'S';
  if (score >= 70) return 'A';
  if (score >= 55) return 'B';
  if (score >= 40) return 'C';
  return 'D';
}

// opts: { build: id, ignore(key) -> bool }
function gearScore(item, opts) {
  opts = opts || {};
  const build = getBuild(opts.build);
  if (!build || !item || !item.slot) return null;
  const slot = slotName(item.slot);
  if (['Charm', 'Life Flask', 'Mana Flask'].includes(slot)) {
    return { score: null, grade: '–', unrated: 'type', slot, build: opts.build || DEFAULT_BUILD, buildName: build.name, contributions: [], penalties: [], wasted: [], missing: [] };
  }
  if (item.unidentified) {
    return { score: null, grade: '–', unrated: 'unidentified', slot, build: opts.build || DEFAULT_BUILD, buildName: build.name, contributions: [], penalties: [], wasted: [], missing: [] };
  }
  if (/unique/i.test(item.rarity || '')) {
    return { score: null, grade: '–', unique: true, slot, build: opts.build || DEFAULT_BUILD, buildName: build.name, contributions: [], penalties: [], wasted: [], missing: [] };
  }
  const ignore = opts.ignore || (() => false);
  const entries = build.stats.filter((e) => pick(e.imp, slot) * ((opts.tweaks && opts.tweaks[e.label] != null) ? Number(opts.tweaks[e.label]) : 1) > 0);

  // What a perfect item for this slot would score: its best K stats at full rolls.
  const K = slot === 'Jewel' ? 4 : ARMOUR_SLOTS.includes(slot) || slot === 'Weapon' ? 7 : 6;
  // resistance caps: how much of each resistance you still need from this slot
  const need = opts.resNeed || null;
  const resNotes = [];
  const tweak = (e) => { const t = opts.tweaks && opts.tweaks[e.label]; return t == null ? 1 : Number(t); };
  const impOf = (e) => pick(e.imp, slot) * tweak(e);
  const usable = entries.filter((e) => {
    // an entry is out of the ideal if every key it covers is ignored
    const sample = { 'Fire res': '#% to Fire Resistance', 'Cold res': '#% to Cold Resistance', 'Lightning res': '#% to Lightning Resistance', 'Chaos res': '#% to Chaos Resistance', Life: '# to maximum Life', Mana: '# to maximum Mana', Intelligence: '# to Intelligence' }[e.label];
    if (sample && ignore(sample)) return false;
    // capped resistances don't count towards a perfect item either
    if (e.res && need && need[e.res] != null && need[e.res] < pick(e.cap, slot) * 0.25) return false;
    return true;
  });
  const ideal = usable.map((e) => impOf(e)).sort((a, b) => b - a).slice(0, K).reduce((a, b) => a + b, 0) || 1;

  const st = item.stats || {};
  const hasBaseDef = st['[Base] Armour'] || st['[Base] Evasion Rating'] || st['[Base] Energy Shield'];
  const dpsScored = !ignore('[Weapon] Total DPS') && usable.some((e) => e.test.test('[Weapon] Total DPS'));
  const contributions = [];
  const wasted = [];
  const used = new Set();
  const usedQ = new Map();
  const resLeft = need && { ...need };
  const penalties = [];
  for (const x of statSources(item).sort((a, b) => (a.source === 'socket') - (b.source === 'socket'))) {
    if (!Number.isFinite(x.value) || x.value === 0) continue;
    if (ignore(x.key)) continue;
    // a weapon's own damage and attack speed mods are already in its DPS
    if (dpsScored && LOCAL_DPS.test(x.key)) continue;
    if (x.value < 0) {
      // a downside on a stat the build wants ("-20% to Chaos Resistance") costs points
      const e = usable.find((en) => en.test.test(x.key));
      if (!e) continue;
      const cap = pick(e.cap, slot) || 1;
      const points = impOf(e) * Math.max(-1, x.value / cap) * (COND.test(x.key) ? 0.6 : 1);
      penalties.push({ key: x.key, label: e.label, value: x.value, points: Math.round(points * 10) / 10, source: x.source });
      continue;
    }
    const e = usable.find((en) => en.test.test(x.key));
    if (!e) {
      const capped = entries.find((en) => en.res && en.test.test(x.key) && !usable.includes(en));
      if (capped) {
        if (!(need && need[capped.res] != null)) continue; // ignored, not capped
        const note = need[capped.res] > 0 ? `${capped.res} res: you only need ${Math.round(need[capped.res])} more to cap, so it barely counts.` : `${capped.res} res: you're already capped – it doesn't count.`;
        if (!resNotes.includes(note)) resNotes.push(note);
        continue;
      }
      // local defence / spirit mods already show up in the [Base] number
      const inBase = (hasBaseDef && LOCAL_DEFENCE.test(x.key)) || (st['[Base] Spirit'] && x.key === '#% increased Spirit');
      if ((x.source === 'mod' || x.source === 'implicit') && !inBase) wasted.push(x.key);
      continue;
    }
    const imp = impOf(e);
    const cap = pick(e.cap, slot) || 1;
    let value = x.value;
    if (e.res && resLeft && resLeft[e.res] != null && value > resLeft[e.res]) {
      resNotes.push(need[e.res] > 0 ? `${e.res} res: you only need ${Math.round(need[e.res])} more to cap – the rest doesn't count.` : `${e.res} res: you're already capped – it doesn't count.`);
      value = resLeft[e.res];
    }
    if (e.res && resLeft && resLeft[e.res] != null) resLeft[e.res] -= value;
    // one stat of the profile can't score more than one top roll, even from several mods
    // (implicit + explicit life, or "+# to all Attributes" counting as Str, Dex and Int)
    const sofar = usedQ.get(e) || 0;
    const quality = Math.max(0, Math.min(value / cap, 1.15 - sofar));
    if (quality <= 0) continue;
    usedQ.set(e, sofar + quality);
    // rune bonuses can be swapped; conditional mods ("if you've Hit Recently", "while ...") aren't always on
    const conditional = COND.test(x.key);
    const factor = (x.source === 'socket' ? 0.5 : 1) * (conditional ? 0.6 : 1);
    const points = imp * quality * factor;
    used.add(e);
    contributions.push({ key: x.key, label: e.label, value: x.value, quality: Math.round(quality * 100), points: Math.round(points * 10) / 10, source: x.source });
  }
  contributions.sort((a, b) => b.points - a.points);
  const total = contributions.reduce((a, c) => a + c.points, 0) + penalties.reduce((a, c) => a + c.points, 0);
  const score = Math.max(0, Math.min(100, Math.round((100 * total) / ideal)));
  const missing = usable
    .filter((e) => !used.has(e))
    .sort((a, b) => impOf(b) - impOf(a))
    .slice(0, 3)
    .filter((e) => impOf(e) >= 5)
    .map((e) => e.label);
  return { score, grade: grade(score), slot, build: opts.build || DEFAULT_BUILD, buildName: build.name, contributions, penalties, wasted, missing, ideal: Math.round(ideal * 10) / 10, resNote: [...new Set(resNotes)].join(' ') || null };
}

// Is this stat something the build wants on this slot? (used to colour the
// popup's change list and pick the "top changes")
function usefulness(slotIn, key, opts) {
  const build = getBuild(opts && opts.build);
  if (!build) return 0;
  const slot = slotName(slotIn);
  const e = build.stats.find((en) => en.test.test(key));
  if (!e) return 0;
  const imp = pick(e.imp, slot);
  const cap = pick(e.cap, slot) || 1;
  return imp > 0 ? imp / cap : 0; // points per unit of the stat
}

// The most important searchable stats for a slot (for "craftable bases").
function topStats(slotIn, n, opts) {
  const build = getBuild(opts && opts.build);
  if (!build) return [];
  const slot = slotName(slotIn);
  const tw = (opts && opts.tweaks) || {};
  return build.stats
    .filter((e) => e.key && !e.res)
    .map((e) => ({ key: e.key, label: e.label, imp: pick(e.imp, slot) * (tw[e.label] != null ? Number(tw[e.label]) : 1), cap: pick(e.cap, slot) }))
    .filter((e) => e.imp >= 4)
    .sort((a, b) => b.imp - a.imp)
    .slice(0, n || 2);
}

// What a slot's gear score is made of, as search weights: points per unit of each stat.
// Ignored stats and resistances you're already capped on are left out.
function searchWeights(slotIn, opts) {
  opts = opts || {};
  const build = getBuild(opts.build);
  if (!build) return [];
  const slot = slotName(slotIn);
  const tw = opts.tweaks || {};
  const ignore = opts.ignore || (() => false);
  const need = opts.resNeed || null;
  const out = [];
  for (const e of build.stats) {
    const imp = pick(e.imp, slot) * (tw[e.label] != null ? Number(tw[e.label]) : 1);
    if (!(imp > 0)) continue;
    if (e.key && ignore(e.key)) continue;
    if (e.res && need && need[e.res] != null && need[e.res] <= 0) continue;
    const cap = pick(e.cap, slot) || 1;
    out.push({ label: e.label, test: e.test, key: e.key || null, w: imp / cap, imp, cap, res: e.res || null, need: e.res && need ? need[e.res] : null });
  }
  return out;
}

// For the gear score editor: each stat line of a build, with where it counts.
function buildStats(id) {
  const b = getBuild(id);
  if (!b) return [];
  const seen = new Set();
  return b.stats.filter((e) => { if (seen.has(e.label)) return false; seen.add(e.label); return true; }).map((e) => {
    const where = typeof e.imp === 'object' ? Object.entries(e.imp).filter(([k, v]) => k !== 'default' && v > 0).map(([k, v]) => `${k} ${v}`) : [];
    const def = typeof e.imp === 'object' ? e.imp.default || 0 : e.imp;
    return { label: e.label, where: def > 0 ? `everywhere ${def}${where.length ? ', ' + where.join(', ') : ''}` : where.join(', ') };
  });
}

function buildList() {
  return Object.entries(BUILDS).map(([id, b]) => ({ id, name: b.name, summary: b.summary }));
}

module.exports = { getBuild, buildParts, buildInfo, fitProfile, pairId, pairOf, COND, gearScore, grade, buildList, buildStats, usefulness, topStats, searchWeights, BUILDS, DEFAULT_BUILD, slotName };
