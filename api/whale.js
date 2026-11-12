// The whale that is swimming right now, if any. Its word is only given out while it is visible.
const { nearby } = require('./_whale');
module.exports = (req, res) => {
  const now = Date.now(), w = nearby(now).find(x => now >= x.start && now < x.end);
  res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=10');
  if (!w) return res.status(200).json({ on: false });
  res.status(200).json({ on: true, id: w.id, start: w.start, end: w.end, word: w.word, golden: w.golden, now });
};
