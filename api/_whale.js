// The cosmic whale: three times a day (10–14, 14–18 and 18–22 Moscow time, at a secret minute) it swims through the
// universe for 10 minutes with a word glowing on it. Everyone who writes that word in the comments within an hour of
// its appearance gets +30. About once a week one of the swims is a golden whale: the first to write its word gets +100.
const crypto = require('crypto');
const { START } = require('./_golden');
const WORDS = ['волна', 'глубина', 'песня', 'плавник', 'фонтан', 'океан', 'прилив', 'жемчуг', 'коралл', 'кашалот',
  'нарвал', 'дельфин', 'медуза', 'лагуна', 'бриз', 'шторм', 'якорь', 'маяк', 'течение', 'раковина'];
const SHOW = 10 * 60e3, CLAIM = 60 * 60e3, PTS = 30, GOLD_PTS = 100, FIRST_DAY = 5; // day 5 = 13 Nov 2026
const LAUNCH = { d: 4, k: 9, start: Date.UTC(2026, 10, 12, 20, 15, 0), golden: true }; // first ever whale: 12 Nov 23:15 Moscow
const H = s => crypto.createHmac('sha256', process.env.GOLDEN_SECRET || process.env.IG_TOKEN || 'orbit').update(s).digest();
const wordOf = id => { const h = H('whaleword' + id); return WORDS[h.readUInt32BE(0) % WORDS.length] + (h.readUInt32BE(4) % 99 + 1); };
function whalesFor(d) {
  const out = [];
  if (d === LAUNCH.d) { const id = d + '_' + LAUNCH.k; out.push({ id, start: LAUNCH.start, end: LAUNCH.start + SHOW, word: wordOf(id), golden: true }); }
  if (d < FIRST_DAY) return out;
  const h = H('whale' + d), dayStart = START + d * 864e5;
  const gw = H('goldwhale' + Math.floor(d / 7)), goldK = gw.readUInt32BE(0) % 7 === d % 7 ? gw.readUInt32BE(4) % 3 : -1;
  for (let k = 0; k < 3; k++) {
    const start = dayStart + (10 * 60 + k * 240 + h.readUInt16BE(k * 2) % 230) * 60e3, id = d + '_' + k;
    out.push({ id, start, end: start + SHOW, word: wordOf(id), golden: k === goldK });
  }
  return out;
}
const dayOf = ms => Math.floor((ms - START) / 864e5);
const nearby = ms => [...whalesFor(dayOf(ms) - 1), ...whalesFor(dayOf(ms))];
module.exports = { SHOW, CLAIM, PTS, GOLD_PTS, whalesFor, nearby };
