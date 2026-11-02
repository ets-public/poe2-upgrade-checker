'use strict';

// "At 20% quality": the copied item with its quality raised to 20%, for Path of Building to judge
// again. Quality raises an armour piece's Armour / Evasion / Energy Shield and a weapon's physical
// damage, so a low-quality item can be a sidegrade now and an upgrade after a few currency orbs.
// Only for items you can still put quality on: armour and weapons (not jewellery, jewels, flasks,
// charms or quivers), not corrupted, mirrored, sanctified or unmodifiable, below 20% now.

const TARGET = 20;
const QUALITY_SLOTS = ['Weapon', 'Offhand', 'Helmet', 'Body Armour', 'Gloves', 'Boots'];
// "Quality: +12% (augmented)"; catalyst quality on jewellery ("Quality (Attack Modifiers): +12%") isn't this
const QUALITY_LINE = /^Quality:\s*\+?(\d+)%.*$/m;

function currentQuality(raw) {
  const m = String(raw || '').match(QUALITY_LINE);
  return m ? Number(m[1]) : 0;
}

// can this item get more quality? (item: the parser's output, with its raw text)
function canRaise(item) {
  if (!item || !item.raw) return false;
  if (!QUALITY_SLOTS.includes(item.slot)) return false;
  if (/quiver/i.test(item.itemClass || '')) return false;
  if (item.corrupted || item.mirrored || item.unidentified || item.unmodifiable) return false;
  if (/^(Sanctified|Mirrored|Unmodifiable|Corrupted)\s*$/m.test(item.raw)) return false;
  return currentQuality(item.raw) < TARGET;
}

// the item's text with its quality at `q` (default 20%): the Quality line changed, or one added at the
// top of the properties when it has none (Path of Building reads it from anywhere in the text)
function withQuality(raw, q = TARGET) {
  const text = String(raw || '');
  const line = `Quality: +${q}% (augmented)`;
  if (QUALITY_LINE.test(text)) return text.replace(QUALITY_LINE, line);
  const lines = text.split(/\r?\n/);
  const sep = lines.findIndex((l) => /^-{4,}\s*$/.test(l));
  if (sep < 0) return `${text.replace(/\s+$/, '')}\n--------\n${line}\n`;
  lines.splice(sep + 1, 0, line);
  return lines.join('\n');
}

// one line for the popup: what the item would be for your build at 20% quality, when that's worth saying
// (main: the verdict now; q20: the verdict with 20% quality, both from pobverdict.judge)
function summarise(main, q20, from) {
  if (!main || !q20 || q20.score == null || main.score == null) return null;
  const gain = Math.round((q20.score - main.score) * 10) / 10;
  if (gain < 0.3) return null; // quality does next to nothing for this build: no line
  return { quality: TARGET, from, score: q20.score, verdict: q20.verdict, gain };
}

module.exports = { TARGET, canRaise, currentQuality, withQuality, summarise };
