// Mini-games and social features: emotes, profiles, café tables, football, cricket scores,
// fishing catches and swim races. All state is in memory, like the rest of the server.

export const HOSTELS = ['Alakananda','Bhadra','Brahmaputra','Cauvery','Ganga','Godavari','Jamuna','Krishna','Mahanadhi','Mandakini',
  'Narmada','Pampa','Sabarmati','Saraswathi','Sarayu','Sharavathi','Sindhu','Tamiraparani','Tapti','Tunga','Day scholar','Other'];
export const YEARS = ['1st year','2nd year','3rd year','4th year','5th year','Masters','PhD','Alumni','Faculty / Staff','Visitor'];
export const DEPTS = ['AE', 'AM', 'BT', 'CE', 'CH', 'CS', 'CY', 'DA', 'ED', 'EE', 'HS', 'MA', 'ME', 'MM', 'MS', 'OE', 'PH', 'Other'];
export const INTERESTS = ['Football','Cricket','Music','Dance','Coding','Gaming','Movies','Books','Startups','Photography','Fitness','Chai','Travel','Art'];
export const EMOTES = ['wave','dance','cheer','clap','sit'];
export const FISH = { Tilapia: 2.5, Rohu: 6, Catla: 8, Murrel: 4, Catfish: 5, 'Golden Mahseer': 12 };
// Football pitch in blocks: W across, L along, goal mouth half width. Must match the client's pitch.
export const PITCH = { W: 13, L: 21, goalHalf: 2 };

const inList = (list, v) => (list.includes(v) ? v : undefined);
export function cleanProfile(p){
  if (!p || typeof p !== 'object') return {};
  const o = {};
  if (inList(HOSTELS, p.h)) o.h = p.h;
  if (inList(YEARS, p.y)) o.y = p.y;
  if (inList(DEPTS, p.d)) o.d = p.d;
  if (Array.isArray(p.i)) { const i = [...new Set(p.i.filter(t => INTERESTS.includes(t)))].slice(0, 3); if (i.length) o.i = i; }
  return o;
}

export function createActivities({ players, send, broadcast, near, clean, num }){
  const r2 = v => Math.round(v * 100) / 100;
  const records = { over: null, fish: null, swim: null };
  const pushRecords = () => broadcast({ t: 'rec', ...records });

  // ---------- café tables ----------
  const tables = new Map();   // tid -> [id, id, id, id]
  const leaveTable = p => {
    if (!p.table) return;
    const seats = tables.get(p.table);
    if (seats) { const i = seats.indexOf(p.id); if (i >= 0) seats[i] = 0; broadcast({ t: 'tbl', tid: p.table, seats }); }
    p.table = null;
  };

  // ---------- football ----------
  const fb = { x: PITCH.W / 2, z: PITCH.L / 2, vx: 0, vz: 0, a: 0, b: 0, moving: false, resetAt: 0, lastKick: 0, tick: 0 };
  const fbState = extra => ({ t: 'fb', x: r2(fb.x), z: r2(fb.z), vx: r2(fb.vx), vz: r2(fb.vz), a: fb.a, b: fb.b, ...extra });
  const centre = () => Object.assign(fb, { x: PITCH.W / 2, z: PITCH.L / 2, vx: 0, vz: 0, moving: false });
  function goal(side){
    fb[side]++;
    const win = fb[side] >= 5 ? side : undefined;
    broadcast(fbState({ goal: side, win }));
    if (win) { fb.a = 0; fb.b = 0; }
    fb.vx = fb.vz = 0; fb.resetAt = Date.now() + 2500;
  }
  setInterval(() => {
    const now = Date.now(), dt = .05;
    if (fb.resetAt) { if (now >= fb.resetAt) { fb.resetAt = 0; centre(); broadcast(fbState()); } return; }
    if ((fb.a || fb.b) && now - fb.lastKick > 5 * 60e3) { fb.a = fb.b = 0; centre(); broadcast(fbState()); }
    if (Math.hypot(fb.vx, fb.vz) < .06) { if (fb.moving) { fb.moving = false; fb.vx = fb.vz = 0; broadcast(fbState()); } return; }
    fb.moving = true;
    fb.x += fb.vx * dt; fb.z += fb.vz * dt;
    const k = Math.exp(-1.15 * dt); fb.vx *= k; fb.vz *= k;
    const R = .3, mouth = Math.abs(fb.x - PITCH.W / 2) < PITCH.goalHalf - R;
    if (fb.x < R) { fb.x = R; fb.vx = Math.abs(fb.vx) * .7; }
    if (fb.x > PITCH.W - R) { fb.x = PITCH.W - R; fb.vx = -Math.abs(fb.vx) * .7; }
    if (mouth && fb.z < -.2) return goal('b');            // Gold scores in Blue's goal (z = 0 end)
    if (mouth && fb.z > PITCH.L + .2) return goal('a');   // Blue scores in Gold's goal (z = L end)
    if (!mouth && fb.z < R) { fb.z = R; fb.vz = Math.abs(fb.vz) * .7; }
    if (!mouth && fb.z > PITCH.L - R) { fb.z = PITCH.L - R; fb.vz = -Math.abs(fb.vz) * .7; }
    if (++fb.tick % 3 === 0) broadcast(fbState());
  }, 50);

  // ---------- swim race ----------
  const race = { state: 'idle', lanes: [], startAt: 0, goAt: 0, results: [], endAt: 0 };
  const raceState = () => ({ t: 'swim', state: race.state, inMs: race.state === 'lobby' ? Math.max(0, race.startAt - Date.now()) : 0,
    lanes: race.lanes.map(id => ({ id, name: players.get(id)?.name || '' })), results: race.results });
  setInterval(() => {
    const now = Date.now();
    race.lanes = race.lanes.filter(id => players.has(id));
    if (race.state === 'lobby' && !race.lanes.length) { race.state = 'idle'; broadcast(raceState()); }
    else if (race.state === 'lobby' && now >= race.startAt) { race.state = 'go'; race.goAt = now; broadcast(raceState()); }
    else if (race.state === 'go' && (race.results.length >= race.lanes.length || now - race.goAt > 90e3)) { race.state = 'done'; race.endAt = now; broadcast(raceState()); }
    else if (race.state === 'done' && now - race.endAt > 8000) { Object.assign(race, { state: 'idle', lanes: [], results: [] }); broadcast(raceState()); }
  }, 250);

  function handle(me, m){
    const now = Date.now();
    switch (m.t) {
      case 'emote': {
        if (!EMOTES.includes(m.e) || now - (me.lastEmote || 0) < 500) return true;
        me.lastEmote = now;
        near(me, { t: 'emote', from: me.id, e: m.e });
        return true;
      }
      case 'sit': {
        const tid = typeof m.tid === 'string' && /^(usha|ccd)-[0-9]$/.test(m.tid) ? m.tid : null;
        const seat = Number.isInteger(m.seat) && m.seat >= 0 && m.seat < 4 ? m.seat : -1;
        if (!tid || seat < 0) return true;
        const seats = tables.get(tid) || [0, 0, 0, 0];
        if (seats[seat] && seats[seat] !== me.id) { send(me, { t: 'sitRes', ok: false, tid, seat }); return true; }
        leaveTable(me);
        seats[seat] = me.id; tables.set(tid, seats); me.table = tid;
        send(me, { t: 'sitRes', ok: true, tid, seat });
        broadcast({ t: 'tbl', tid, seats });
        return true;
      }
      case 'stand': leaveTable(me); return true;
      case 'tsay': {
        const text = clean(m.text, 160);
        if (!me.table || !text || now - (me.lastSay || 0) < 800) return true;
        me.lastSay = now;
        for (const id of tables.get(me.table) || []) { const p = players.get(id); if (p && p !== me) send(p, { t: 'tsay', from: me.id, name: me.name, text }); }
        return true;
      }
      case 'fbk': {
        const x = num(m.x, -3, PITCH.W + 3), z = num(m.z, -3, PITCH.L + 3), dx = num(m.dx, -1.5, 1.5), dz = num(m.dz, -1.5, 1.5), p = num(m.p, .1, 1);
        if (x === null || z === null || dx === null || dz === null || p === null || fb.resetAt) return true;
        if (now - (me.lastKick || 0) < 110 || Math.hypot(x - fb.x, z - fb.z) > 1.8) return true;
        const len = Math.hypot(dx, dz) || 1;
        me.lastKick = now; fb.lastKick = now;
        fb.vx = dx / len * p * 15; fb.vz = dz / len * p * 15; fb.moving = true;
        broadcast(fbState({ by: me.name }));
        return true;
      }
      case 'crk': {
        const runs = num(m.runs, 0, 36), balls = num(m.balls, 0, 6), last = typeof m.last === 'string' && /^(0|1|2|3|4|6|W)$/.test(m.last) ? m.last : null;
        if (runs === null || balls === null || !last || now - (me.lastCrk || 0) < 600) return true;
        me.lastCrk = now;
        near(me, { t: 'crk', from: me.id, name: me.name, runs, balls, last }, 90);
        if (balls === 6 && (!records.over || runs > records.over.runs)) { records.over = { name: me.name, runs }; pushRecords(); }
        return true;
      }
      case 'fish': {
        const kind = Object.hasOwn(FISH, m.kind) ? m.kind : null, kg = kind ? num(m.kg, .2, FISH[kind]) : null;
        if (!kind || kg === null || now - (me.lastFish || 0) < 4000) return true;
        me.lastFish = now;
        near(me, { t: 'fish', from: me.id, name: me.name, kind, kg: r2(kg) }, 90);
        if (!records.fish || kg > records.fish.kg) { records.fish = { name: me.name, kind, kg: r2(kg) }; pushRecords(); }
        return true;
      }
      case 'swim': {
        if (m.ev === 'join') {
          if (race.state === 'idle') Object.assign(race, { state: 'lobby', lanes: [], results: [], startAt: now + 8000 });
          if (race.state === 'lobby' && race.lanes.length < 6 && !race.lanes.includes(me.id)) race.lanes.push(me.id);
          broadcast(raceState());
        } else if (m.ev === 'leave' && race.state === 'lobby') {
          race.lanes = race.lanes.filter(id => id !== me.id); broadcast(raceState());
        } else if (m.ev === 'finish' && race.state === 'go' && race.lanes.includes(me.id) && !race.results.some(r => r.id === me.id)) {
          const ms = num(m.ms, 4000, 90e3);
          if (ms === null || ms > now - race.goAt + 1500) return true;   // can't finish faster than the race has run
          race.results.push({ id: me.id, name: me.name, ms: Math.round(ms) });
          race.results.sort((a, b) => a.ms - b.ms);
          if (!records.swim || ms < records.swim.ms) { records.swim = { name: me.name, ms: Math.round(ms) }; pushRecords(); }
          broadcast(raceState());
        }
        return true;
      }
    }
    return false;
  }

  return {
    handle,
    welcome: () => ({ fb: fbState(), tables: [...tables], race: raceState(), rec: records }),
    leave: p => { leaveTable(p); race.lanes = race.lanes.filter(id => id !== p.id); },
  };
}
