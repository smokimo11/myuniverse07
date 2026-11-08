// Daily golden asteroid codes. Day 0 (8 Nov 2026, Moscow time) is "туманность"; every later day is a space word
// plus a number, derived from a server-side secret so the list cannot be read from the public code.
const crypto = require('crypto');
const START = Date.UTC(2026, 10, 7, 21, 0, 0); // 8 Nov 2026 00:00 Moscow
const DAYS = 500;
const WORDS = ['квазар', 'пульсар', 'комета', 'орбита', 'нейтрон', 'галактика', 'затмение', 'метеор', 'протон', 'сверхновая',
  'астероид', 'гравитация', 'спутник', 'созвездие', 'горизонт', 'магнетар', 'фотон', 'плазма', 'кратер', 'полярис',
  'андромеда', 'орион', 'сириус', 'вега', 'кассиопея', 'персей', 'лира', 'пегас', 'феникс', 'меркурий',
  'венера', 'марс', 'юпитер', 'сатурн', 'уран', 'нептун', 'плутон', 'титан', 'европа', 'ганимед',
  'каллисто', 'ио', 'энцелад', 'тритон', 'церера', 'хаумеа', 'эрида', 'макемаке', 'кометник', 'зенит'];
const dayIndex = (ms = Date.now()) => Math.floor((ms - START) / 864e5);
function codeFor(d) {
  if (d < 0 || d >= DAYS) return null;
  if (d === 0) return 'туманность';
  const h = crypto.createHmac('sha256', process.env.GOLDEN_SECRET || process.env.IG_TOKEN || 'orbit').update('day' + d).digest();
  return WORDS[h.readUInt32BE(0) % WORDS.length] + (h.readUInt32BE(4) % 999 + 1);
}
const normCode = t => (t || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]/gu, '');
module.exports = { START, DAYS, dayIndex, codeFor, normCode };
