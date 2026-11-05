// Live orbit data: residents.json (followers from the Instagram export) + points for activity,
// read once in a while from the official Instagram API and cached by Vercel.
// The token lives only in the Vercel environment variable IG_TOKEN and never leaves the server.
const fs = require('fs');
const path = require('path');

// Two kinds of keys work: a system user token from the business portfolio (needs IG_USER_ID, graph.facebook.com)
// or an Instagram login token (graph.instagram.com, /me).
const VER = 'v26.0';
const COMMENT_PTS = 3, COMMENT_DAY_CAP = 15, FRIEND_PTS = 20, MIN_WORDS = 3;
const TZ_OFFSET_MS = 3 * 3600e3; // days are counted by Moscow time

async function get(url) {
  const r = await fetch(url);
  const j = await r.json();
  if (!r.ok || j.error) throw new Error((j.error && j.error.message) || 'HTTP ' + r.status);
  return j;
}
async function all(url) {
  const out = [];
  let next = url, guard = 0;
  while (next && guard++ < 40) { const j = await get(next); out.push(...(j.data || [])); next = j.paging && j.paging.next; }
  return out;
}

const words = t => (t || '').split(/\s+/).filter(w => !w.startsWith('@') && /[\p{L}\p{N}]/u.test(w)).length;
const norm = t => (t || '').toLowerCase().replace(/@[\w.]+/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
const mentions = t => [...(t || '').matchAll(/@([A-Za-z0-9._]{1,30})/g)].map(m => m[1].replace(/\.$/, '').toLowerCase());
const day = ms => new Date(ms + TZ_OFFSET_MS).toISOString().slice(0, 10);

async function collectComments(token, since) {
  // Facebook-type keys start with "EAA" and talk to graph.facebook.com; Instagram keys ("IGAA…") to graph.instagram.com
  const fb = token.startsWith('EAA');
  const API = fb ? `https://graph.facebook.com/${VER}` : `https://graph.instagram.com/${VER}`;
  let igId = process.env.IG_USER_ID;
  if (fb && !igId) {
    const pages = await all(`${API}/me/accounts?fields=instagram_business_account&access_token=${token}`);
    const p = pages.find(x => x.instagram_business_account);
    if (!p) throw new Error('IG_USER_ID is not set and no Instagram account found');
    igId = p.instagram_business_account.id;
  }
  const media = await all(`${API}/${igId || 'me'}/media?fields=id,timestamp&limit=50&access_token=${token}`);
  const list = [];
  // all videos at once, so the whole check fits well inside the function time limit
  const per = await Promise.all(media.filter(m => Date.parse(m.timestamp) >= since).map(m =>
    all(`${API}/${m.id}/comments?fields=id,text,timestamp,username,replies{id,text,timestamp,username}&limit=50&access_token=${token}`)
      .catch(e => { console.error('comments', m.id, e.message); return []; })));
  for (const cs of per) for (const c of cs) {
    list.push(c);
    for (const r of (c.replies && c.replies.data) || []) list.push(r);
  }
  return list.map(c => ({ u: (c.username || '').toLowerCase(), text: c.text || '', ts: Date.parse(c.timestamp) }))
             .filter(c => c.u && c.ts).sort((a, b) => a.ts - b.ts);
}

function score(data, comments) {
  const acc = (data.account || '').toLowerCase();
  const subs = new Map((data.subscribers || []).map(s => [s.nick.toLowerCase(), s]));
  const bonus = new Map(), stat = new Map();
  const add = (u, k, v) => { bonus.set(u, (bonus.get(u) || 0) + v); const s = stat.get(u) || { comments: 0, friends: 0 }; s[k] += v; stat.set(u, s); };
  const seenText = new Set(), dayPts = new Map(), invited = new Set();
  for (const c of comments) {
    if (c.u === acc) continue;
    // comment points: 3+ words, no repeats of the same text by the same person, at most 15 points a day
    const key = c.u + '|' + norm(c.text), dk = c.u + '|' + day(c.ts);
    if (words(c.text) >= MIN_WORDS && norm(c.text) && !seenText.has(key) && (dayPts.get(dk) || 0) < COMMENT_DAY_CAP) {
      seenText.add(key); dayPts.set(dk, (dayPts.get(dk) || 0) + COMMENT_PTS); add(c.u, 'comments', COMMENT_PTS);
    }
    // friend points: the tagged friend follows now and followed only after this comment; first tagger wins
    if (!subs.has(c.u)) continue;
    for (const b of mentions(c.text)) {
      if (b === c.u || b === acc || invited.has(b)) continue;
      const f = subs.get(b);
      if (!f || !f.since || f.since * 1000 <= c.ts) continue;
      invited.add(b); add(c.u, 'friends', FRIEND_PTS);
    }
  }
  data.subscribers = (data.subscribers || []).map(s => {
    const u = s.nick.toLowerCase(), b = bonus.get(u) || 0, st = stat.get(u);
    const o = { nick: s.nick, points: (s.points || 0) + b };
    if (s.leftAt) o.leftAt = s.leftAt;
    if (st) o.activity = st;
    return o;
  });
  return { counted: comments.length, people: stat.size, invites: invited.size };
}

module.exports = async (req, res) => {
  try {
  const data = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'residents.json'), 'utf8'));
  const token = process.env.IG_TOKEN;
  let info = { live: false };
  try {
    if (token && data.countFrom) {
      const comments = await Promise.race([collectComments(token, Date.parse(data.countFrom)),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 25000))]);
      info = { live: true, ...score(data, comments) };
    }
  } catch (e) {
    console.error('instagram api:', e.message);
    info = { live: false, error: 'instagram api unavailable' };
  }
  for (const s of data.subscribers || []) delete s.since;
  data.updated = new Date().toISOString();
  data.info = info;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');
  res.status(200).send(JSON.stringify(data));
  } catch (e) {
    console.error('residents:', e.message);
    res.status(500).json({ error: 'failed' });
  }
};
module.exports.config = { maxDuration: 30 };
