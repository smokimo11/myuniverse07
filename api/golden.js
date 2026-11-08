// Today's golden asteroid: its secret word, opened when someone finds the asteroid on the map.
const { dayIndex, codeFor } = require('./_golden');
module.exports = (req, res) => {
  const d = dayIndex();
  const code = codeFor(d);
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=60');
  if (!code) return res.status(404).json({ error: 'no asteroid today' });
  res.status(200).json({ day: d, code });
};
