// IITM Craft multiplayer server.
// Serves the game page and relays player positions, vehicle occupancy and 1:1 chat over WebSockets.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT) || 8787;
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS) || 150;
const TICK_MS = 100;            // snapshot rate (10 Hz)
const VIEW_RANGE = 220;         // only send players within this many blocks
const CHAT_RANGE = 10;          // how close two students must be to start a chat
const WORLD = { x: 480, z: 528, yMin: -20, yMax: 80 };
const ANIMS = new Set(['walk', 'air', 'fly', 'sit', 'cycle']);
const INDEX = new URL('../index.html', import.meta.url);

const players = new Map();      // id -> player
const vehicles = new Map();     // vehicle id -> { x, z, h, driver }
let nextId = 1;

// Chat is rendered as plain text on the client, so only control characters are removed.
// Names also lose angle brackets because they appear on 3D name tags and in lists.
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanName = s => clean(s, 16).replace(/[<>]/g, '').trim();
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const r2 = v => Math.round(v * 100) / 100;
const send = (p, msg) => { if (p.ws.readyState === 1) p.ws.send(JSON.stringify(msg)); };
const broadcast = (msg, except) => { const s = JSON.stringify(msg); for (const p of players.values()) if (p !== except && p.ws.readyState === 1) p.ws.send(s); };
const pub = p => ({ id: p.id, name: p.name, kind: p.kind, x: p.x, y: p.y, z: p.z, f: p.f, a: p.a, v: p.v, vh: p.vh, st: p.seat });
// An e-buggy seats a driver plus up to 3 passengers; bicycles only a rider.
const MAX_PASSENGERS = 3;
const vehState = (vid, v, withPos) => ({ t: 'veh', vid, driver: v.driver, riders: v.riders, ...(withPos ? { x: r2(v.x), z: r2(v.z), h: r2(v.h) } : {}) });
function leaveVehicle(p){
  if (p.v < 0) return;
  const v = vehicles.get(p.v);
  if (v) {
    if (p.seat === 0 && v.driver === p.id) { Object.assign(v, { driver: 0, x: p.x, z: p.z, h: p.vh }); broadcast(vehState(p.v, v, true), p); }
    else if (p.seat > 0 && v.riders[p.seat - 1] === p.id) { v.riders[p.seat - 1] = 0; broadcast(vehState(p.v, v, false), p); }
  }
  p.v = -1; p.seat = 0;
}

// ---------- Feature suggestions ----------
// Forwarded to a Google Form, whose responses collect in a Google Sheet. Set on the host:
//   FEEDBACK_FORM_ID      the id in https://docs.google.com/forms/d/e/<id>/viewform
//   FEEDBACK_TITLE_ENTRY  e.g. entry.123456789 (the "Title" question)
//   FEEDBACK_DESC_ENTRY   e.g. entry.987654321 (the "Description" question)
const FORM = {
  id: process.env.FEEDBACK_FORM_ID,
  title: process.env.FEEDBACK_TITLE_ENTRY,
  desc: process.env.FEEDBACK_DESC_ENTRY,
};
const feedbackLog = new Map();  // ip -> recent submission times
const FEEDBACK_PER_HOUR = 5;
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };

async function handleFeedback(req, res){
  if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' });
  if (!FORM.id || !FORM.title || !FORM.desc) return json(res, 503, { error: 'not_configured' });
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const now = Date.now(), recent = (feedbackLog.get(ip) || []).filter(t => now - t < 3600e3);
  if (recent.length >= FEEDBACK_PER_HOUR) return json(res, 429, { error: 'too_many' });

  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 4096) return json(res, 413, { error: 'too_long' }); }
  let body; try { body = JSON.parse(raw); } catch { return json(res, 400, { error: 'bad_json' }); }
  // Keep line breaks in the description; drop other control characters.
  const title = clean(body.title, 80);
  const desc = String(body.desc ?? '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim().slice(0, 1000);
  if (title.length < 3) return json(res, 400, { error: 'title_required' });

  try {
    const r = await fetch(`https://docs.google.com/forms/d/e/${encodeURIComponent(FORM.id)}/formResponse`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ [FORM.title]: title, [FORM.desc]: desc }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(`Google Forms answered ${r.status}`);
  } catch (e) {
    console.error('Feedback forward failed:', e.message);
    return json(res, 502, { error: 'forward_failed' });
  }
  recent.push(now); feedbackLog.set(ip, recent);
  console.log(`Feedback received: "${title}"`);
  json(res, 200, { ok: true });
}

// ---------- HTTP ----------
const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/' || pathname === '/index.html') {
    try {
      const html = await readFile(INDEX);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      res.end(html);
    } catch { res.writeHead(500); res.end('Game file missing'); }
  } else if (pathname === '/api/online') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ online: players.size }));
  } else if (pathname === '/api/feedback') {
    await handleFeedback(req, res);
  } else if (pathname === '/health') {
    res.writeHead(200); res.end('ok');
  } else {
    res.writeHead(404); res.end('Not found');
  }
});

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2048 });

wss.on('connection', ws => {
  let me = null;
  let budget = 60, budgetAt = Date.now();
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', raw => {
    const now = Date.now();
    if (now - budgetAt > 1000) { budget = 60; budgetAt = now; }
    if (--budget < 0) return ws.close(1008, 'Too many messages');
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;

    if (!me) {
      if (m.t !== 'join') return;
      if (players.size >= MAX_PLAYERS) { ws.send(JSON.stringify({ t: 'full' })); return ws.close(); }
      me = { ws, id: nextId++, name: cleanName(m.name) || 'Student', kind: m.kind === 'girl' ? 'girl' : 'boy',
        x: 0, y: 0, z: 0, f: 0, a: 'walk', v: -1, seat: 0, vh: 0, chatWith: 0, pendingFrom: new Map(), lastReq: 0, lastChat: 0, ready: false };
      players.set(me.id, me);
      send(me, { t: 'welcome', id: me.id, online: players.size,
        players: [...players.values()].filter(p => p !== me && p.ready).map(pub),
        vehicles: [...vehicles].map(([id, v]) => [id, r2(v.x), r2(v.z), r2(v.h), v.driver, v.riders]) });
      return;
    }

    switch (m.t) {
      case 's': {
        const x = num(m.x, -5, WORLD.x + 5), y = num(m.y, WORLD.yMin, WORLD.yMax), z = num(m.z, -5, WORLD.z + 5);
        if (x === null || y === null || z === null) return;
        Object.assign(me, { x, y, z, f: num(m.f, -1e4, 1e4) ?? 0, a: ANIMS.has(m.a) ? m.a : 'walk', vh: num(m.vh, -1e4, 1e4) ?? 0 });
        if (!me.ready) { me.ready = true; broadcast({ t: 'add', p: pub(me) }, me); }
        return;
      }
      case 'enter': {
        // as: 'drive' (default) or 'ride' (passenger seat, e-buggies only: cap = passenger seats)
        const vid = Number.isInteger(m.vid) && m.vid >= 0 && m.vid < 1000 ? m.vid : -1;
        const fail = () => send(me, { t: 'enterRes', vid, ok: false, as: m.as === 'ride' ? 'ride' : 'drive' });
        if (vid < 0 || me.v >= 0) return fail();
        let v = vehicles.get(vid);
        if (!v) { v = { x: me.x, z: me.z, h: me.vh, driver: 0, riders: [0, 0, 0] }; vehicles.set(vid, v); }
        if (m.as === 'ride') {
          const cap = Math.max(0, Math.min(MAX_PASSENGERS, m.cap | 0));
          const i = v.riders.findIndex((r, k) => k < cap && !r);
          if (i < 0) return fail();
          v.riders[i] = me.id; me.v = vid; me.seat = i + 1;
        } else {
          if (v.driver && v.driver !== me.id) return fail();
          v.driver = me.id; me.v = vid; me.seat = 0;
        }
        send(me, { t: 'enterRes', vid, ok: true, as: me.seat ? 'ride' : 'drive', seat: me.seat });
        broadcast(vehState(vid, v, false), me);
        return;
      }
      case 'exit': {
        if (me.v < 0) return;
        const v = vehicles.get(me.v);
        if (v && me.seat === 0) {
          const x = num(m.x, 0, WORLD.x), z = num(m.z, 0, WORLD.z), h = num(m.h, -1e4, 1e4);
          if (x !== null && z !== null) { me.x = x; me.z = z; }
          if (h !== null) me.vh = h;
        }
        leaveVehicle(me);
        return;
      }
      case 'chatReq': {
        const to = players.get(m.to);
        if (!to || to === me || me.chatWith || to.chatWith || Date.now() - me.lastReq < 2000) return;
        if (Math.hypot(to.x - me.x, to.z - me.z) > CHAT_RANGE) return;
        me.lastReq = Date.now();
        to.pendingFrom.set(me.id, Date.now());
        send(to, { t: 'chatReq', from: me.id, name: me.name });
        return;
      }
      case 'chatResp': {
        const from = players.get(m.to);
        const at = me.pendingFrom.get(m.to);
        me.pendingFrom.delete(m.to);
        if (!from || !at || Date.now() - at > 30000) return;
        if (m.ok === true && !me.chatWith && !from.chatWith) {
          me.chatWith = from.id; from.chatWith = me.id;
          send(me, { t: 'chatOpen', with: from.id, name: from.name });
          send(from, { t: 'chatOpen', with: me.id, name: me.name });
        } else send(from, { t: 'chatDeclined', from: me.id, name: me.name });
        return;
      }
      case 'chat': {
        const to = players.get(me.chatWith);
        const text = clean(m.text, 240);
        if (!to || !text || Date.now() - me.lastChat < 350) return;
        me.lastChat = Date.now();
        send(to, { t: 'chat', from: me.id, name: me.name, text });
        return;
      }
      case 'chatEnd': endChat(me); return;
    }
  });

  ws.on('close', () => {
    if (!me) return;
    endChat(me);
    leaveVehicle(me);
    players.delete(me.id);
    broadcast({ t: 'del', id: me.id });
  });
});

function endChat(p){
  const other = players.get(p.chatWith);
  p.chatWith = 0;
  if (other && other.chatWith === p.id) { other.chatWith = 0; send(other, { t: 'chatEnd', from: p.id }); }
}

// Snapshots: every player gets the others within view range.
setInterval(() => {
  const list = [...players.values()].filter(p => p.ready);
  for (const p of players.values()) {
    const ps = [];
    for (const o of list) if (o !== p && Math.hypot(o.x - p.x, o.z - p.z) < VIEW_RANGE)
      ps.push([o.id, r2(o.x), r2(o.y), r2(o.z), r2(o.f), o.a, o.v, r2(o.vh), o.seat]);
    send(p, { t: 'snap', n: players.size, ps });
  }
}, TICK_MS);

// Drop dead connections.
setInterval(() => {
  for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); }
}, 30000);

server.listen(PORT, () => console.log(`IITM Craft running at http://localhost:${PORT}`));
