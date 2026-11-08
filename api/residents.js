// Live orbit data: residents.json (followers from the Instagram export) + points for activity,
// read once in a while from the official Instagram API and cached by Vercel.
// The token lives only in the Vercel environment variable IG_TOKEN and never leaves the server.
const fs = require('fs');
const { dayIndex, codeFor, normCode } = require('./_golden');
const path = require('path');

// Two kinds of keys work: a system user token from the business portfolio (needs IG_USER_ID, graph.facebook.com)
// or an Instagram login token (graph.instagram.com, /me).
const VER = 'v26.0';
const COMMENT_PTS = 3, COMMENT_DAY_CAP = 15, GOLDEN_PTS = 50,
  METEOR_DAYS = new Set(['2026-11-13', '2026-11-14', '2026-11-15']), METEOR_CAP = 30, FRIEND_PTS = 20, MIN_LETTERS = 4;
const TZ_OFFSET_MS = 3 * 3600e3; // days are counted by Moscow time

async function get(url) {
  const r = await fetch(url);
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error ? `${j.error.type || ''} ${j.error.code || ''}/${j.error.error_subcode || ''}: ${j.error.message}` : 'HTTP ' + r.status);
  return j;
}
async function all(url) {
  const out = [];
  let next = url, guard = 0;
  while (next && guard++ < 40) { const j = await get(next); out.push(...(j.data || [])); next = j.paging && j.paging.next; }
  return out;
}

// A comment counts if it has at least one real-looking word: 4+ letters after squeezing stretched letters
// ("суперррр" -> "супер"), with vowels, not one letter repeated and not a keyboard mash.
const VOW = /[аеёиоуыэюяaeiouy]/i;
const ROWS = ['йцукенгшщзхъ', 'фывапролджэ', 'ячсмитьбю', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
function realWord(w) {
  if (w.startsWith('@') || w.startsWith('#')) return false;
  const x = w.toLowerCase().replace(/[^\p{L}]/gu, '').replace(/(\p{L})\1{2,}/gu, '$1');
  if (x.length < MIN_LETTERS || new Set(x).size < 3) return false;
  const v = [...x].filter(ch => VOW.test(ch)).length / x.length;
  if (ROWS.some(r => { for (let i = 0; i + 4 <= r.length; i++) if (x.includes(r.slice(i, i + 4))) return true; return false; })) return false;
  return v >= 0.2 && v <= 0.8 && !/[^аеёиоуыэюяaeiouy\s]{5,}/i.test(x);
}
const meaningful = t => (t || '').split(/\s+/).some(realWord);
const norm = t => (t || '').toLowerCase().replace(/@[\w.]+/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
const mentions = t => [...(t || '').matchAll(/@([A-Za-z0-9._]{1,30})/g)].map(m => m[1].replace(/\.$/, '').toLowerCase());
// subscription: +5 on day one and +1 for every full day since; "bonus" is a manual award from the author (challenges)
const SUB_START = 5, SUB_DAY = 1;
const subPoints = s => (s.since ? SUB_START + Math.floor((Date.now() - s.since * 1000) / 864e5) * SUB_DAY : (s.points || 0)) + (s.bonus || 0);
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

function score(data, comments, trace) {
  const traced = [];
  const acc = (data.account || '').toLowerCase();
  const subs = new Map((data.subscribers || []).map(s => [s.nick.toLowerCase(), s]));
  const bonus = new Map(), stat = new Map();
  const add = (u, k, v) => { bonus.set(u, (bonus.get(u) || 0) + v); const s = stat.get(u) || { comments: 0, friends: 0, pending: 0, golden: 0 }; s[k] += v; stat.set(u, s); };
  const seenText = new Set(), dayPts = new Map(), invited = new Set(), goldenWon = new Map();
  // the newest follow time in the export tells how fresh the export is
  const exportedAt = Math.max(0, ...(data.subscribers || []).map(s => (s.since || 0) * 1000));
  for (const c of comments) {
    if (c.u === acc) continue;
    // comment points: a meaningful comment (see realWord), no repeats of the same text by the same person, at most 15 points a day
    const key = c.u + '|' + norm(c.text), dk = c.u + '|' + day(c.ts);
    let why = 'засчитан +3';
    if (!meaningful(c.text) || !norm(c.text)) why = 'нет настоящего слова от 4 букв';
    else if (seenText.has(key)) why = 'повтор';
    else if ((dayPts.get(dk) || 0) >= (METEOR_DAYS.has(day(c.ts)) ? METEOR_CAP : COMMENT_DAY_CAP)) why = METEOR_DAYS.has(day(c.ts)) ? 'лимит 30 в день (метеоритный дождь)' : 'лимит 15 в день';
    else { seenText.add(key); dayPts.set(dk, (dayPts.get(dk) || 0) + COMMENT_PTS); add(c.u, 'comments', COMMENT_PTS); }
    if (trace && c.u === trace) traced.push({ text: c.text, time: new Date(c.ts).toISOString(), day: day(c.ts), result: why });
    // golden asteroid: the first subscriber to write the day's code under any video that same day gets +50
    if (subs.has(c.u)) {
      const d = dayIndex(c.ts), code = codeFor(d);
      if (code && !goldenWon.has(d) && normCode(c.text).includes(normCode(code))) {
        goldenWon.set(d, c.u); add(c.u, 'golden', GOLDEN_PTS);
        if (trace && c.u === trace) traced.push({ text: c.text, time: new Date(c.ts).toISOString(), day: day(c.ts), result: 'золотой астероид +50' });
      }
    }
    // friend points, first tagger wins, one friend counts once:
    //  confirmed - the friend is in the follower export and followed after this comment;
    //  pending   - the friend is not in the export yet, but commented after being tagged and no export
    //              has been taken since the tag; the next export confirms the points or drops them.
    if (!subs.has(c.u)) continue;
    for (const b of mentions(c.text)) {
      if (b === c.u || b === acc || invited.has(b)) continue;
      const f = subs.get(b);
      if (f && f.since) {
        invited.add(b);
        if (f.since * 1000 > c.ts) add(c.u, 'friends', FRIEND_PTS);
        continue;
      }
      if (c.ts <= exportedAt) continue;
      if (!comments.some(x => x.u === b && x.ts > c.ts)) continue;
      invited.add(b); add(c.u, 'pending', FRIEND_PTS);
    }
  }
  data.subscribers = (data.subscribers || []).map(s => {
    const u = s.nick.toLowerCase(), b = bonus.get(u) || 0, st = stat.get(u);
    const o = { nick: s.nick, points: subPoints(s) + b };
    if (s.leftAt) o.leftAt = s.leftAt;
    if (st) o.activity = st;
    return o;
  });
  let pend = 0, conf = 0; for (const v of stat.values()) { pend += v.pending / FRIEND_PTS; conf += v.friends / FRIEND_PTS; }
  const today = dayIndex();
  const r = { counted: comments.length, people: stat.size, invites: conf, pending: pend, goldenToday: goldenWon.get(today) || null, goldenDay: today, goldenWins: goldenWon.size };
  if (trace) r.check = { nick: trace, subscribed: subs.has(trace), comments: traced };
  return r;
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
      const trace = (req.query && typeof req.query.check === 'string') ? req.query.check.toLowerCase().replace(/^@/, '').slice(0, 30) : '';
      info = { live: true, ...score(data, comments, trace) };
    }
  } catch (e) {
    console.error('instagram api:', e.message);
    info = { live: false, error: String(e.message || e).replace(/access_token=[^&\s]+/g, 'access_token=…').slice(0, 300) };
  }
  if (!info.live) data.subscribers = (data.subscribers || []).map(s => { const o = { nick: s.nick, points: subPoints(s) }; if (s.leftAt) o.leftAt = s.leftAt; return o; });
  // keep only the hour someone arrived (for the Big Bang replay on the site), not the exact moment
  const hours = new Map((JSON.parse(fs.readFileSync(path.join(process.cwd(), 'residents.json'), 'utf8')).subscribers || []).filter(x => x.since).map(x => [String(x.nick).toLowerCase(), Math.floor(x.since / 3600)]));
  for (const s of data.subscribers || []) { const h = hours.get(String(s.nick).toLowerCase()); if (h) s.b = h; delete s.since; delete s.bonus; }
  data.updated = new Date().toISOString();
  data.info = info;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=3600');
  res.status(200).send(JSON.stringify(data));
  } catch (e) {
    console.error('residents:', e.message);
    res.status(500).json({ error: 'failed' });
  }
};
module.exports.config = { maxDuration: 30 };
module.exports.collectComments = collectComments;
