// Who has found today's golden asteroid. Checked often (every ~10 min) so the asteroid disappears from the map
// soon after someone writes the code; once found, the answer is cached until Moscow midnight.
const { START, dayIndex, codeFor, normCode } = require('./_golden');
const { collectComments } = require('./residents');
const fs = require('fs'), path = require('path');
module.exports = async (req, res) => {
  const d = dayIndex(), code = codeFor(d), token = process.env.IG_TOKEN;
  const dayStart = START + d * 864e5, untilMidnight = Math.max(60, Math.round((dayStart + 864e5 - Date.now()) / 1000));
  if (!code || !token) { res.setHeader('Cache-Control', 'public, s-maxage=600'); return res.status(200).json({ day: d, winner: null }); }
  try {
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 25000));
    const comments = await Promise.race([collectComments(token, 0), timeout]);
    const data = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'residents.json'), 'utf8'));
    const subs = new Set((data.subscribers || []).filter(x => !x.leftAt).map(x => String(x.nick).toLowerCase()));
    const want = normCode(code);
    const hit = comments.find(c => c.ts >= dayStart && c.ts < dayStart + 864e5 && subs.has(c.u) && normCode(c.text).includes(want));
    const winner = hit ? hit.u : null;
    res.setHeader('Cache-Control', winner ? `public, s-maxage=${untilMidnight}` : 'public, s-maxage=600, stale-while-revalidate=120');
    res.status(200).json({ day: d, winner });
  } catch (e) {
    res.setHeader('Cache-Control', 'public, s-maxage=300');
    res.status(200).json({ day: d, winner: null, error: e.message });
  }
};
module.exports.config = { maxDuration: 30 };
