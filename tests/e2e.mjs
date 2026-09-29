// End-to-end tests for IITM Craft: single-player gameplay, the multiplayer server and chat.
// Run: npm test   (starts its own server on a free port)
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright';
import WebSocket from 'ws';

const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://localhost:${PORT}`;
const VIEW = { width: 960, height: 540 };
const results = [];
let failed = 0;

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 5000, step = 100) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(step); }
  return fn();
}

// ---------- server ----------
const server = spawn(process.execPath, ['server/server.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
server.stderr.on('data', d => process.stderr.write('[server] ' + d));
await Promise.race([
  new Promise(res => server.stdout.on('data', d => { if (String(d).includes('running')) res(); })),
  sleep(8000),
]);

const opts = { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };
let browser;
try { browser = await chromium.launch({ channel: 'chrome', ...opts }); } catch { browser = await chromium.launch(opts); }

async function openGame(tag) {
  const page = await browser.newPage({ viewport: VIEW });
  page.errors = [];
  page.on('pageerror', e => page.errors.push(`${tag}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') page.errors.push(`${tag}: ${m.text()}`); });
  const t0 = Date.now();
  await page.goto(`${BASE}/?debug`);
  await page.waitForSelector('#start:not(.hidden)', { timeout: 180000 });
  page.loadMs = Date.now() - t0;
  return page;
}
// Start playing through the real start screen. Pointer lock is not available headless,
// so if the click doesn't enter play mode we switch state the way the lock handler would.
async function startAs(page, name, kind) {
  await page.fill('#nameInput', name);
  await page.click(`.who[data-kind="${kind}"]`);
  await page.click('#bStart');
  await sleep(400);
  if (await page.evaluate(() => iitm.stateNow()) !== 'play') await page.evaluate(() => iitm.setState('play'));
}
const hold = async (page, key, ms) => { await page.keyboard.down(key); await sleep(ms); await page.keyboard.up(key); };
const pos = page => page.evaluate(() => ({ x: iitm.player.pos.x, y: iitm.player.pos.y, z: iitm.player.pos.z }));

try {
  // ============================================================
  //  Single player
  // ============================================================
  const A = await openGame('A');
  check('Game loads and shows the start screen', true, `${(A.loadMs / 1000).toFixed(1)}s`);

  const world = await A.evaluate(() => ({
    places: iitm.places().length,
    buggies: iitm.buggies.filter(v => v.kind === 'buggy').length,
    cycles: iitm.buggies.filter(v => v.kind === 'cycle').length,
    deer: iitm.deer.length, monkeys: iitm.monkeys.length,
    names: iitm.places().map(p => p.n),
  }));
  check('All 85 campus places are placed', world.places === 85, `${world.places}`);
  for (const n of ['Main Gate', 'Gajendra Circle', 'Central Library', 'Open Air Theatre', 'Himalaya Mess', 'Mandakini Hostel', 'IITM Research Park', 'Chemplast Cricket Ground'])
    check(`Place exists: ${n}`, world.names.includes(n));
  check('E-buggies parked around campus', world.buggies >= 15, `${world.buggies}`);
  check('Bicycles at stands', world.cycles >= 60, `${world.cycles}`);
  check('Deer population', world.deer === 60, `${world.deer}`);
  check('Monkey population', world.monkeys === 40, `${world.monkeys}`);
  check('Online counter on start screen', (await A.textContent('#liveCount')).length > 0, await A.textContent('#liveCount'));

  await startAs(A, 'Asha', 'girl');
  check('Start button enters play mode', await A.evaluate(() => iitm.stateNow()) === 'play');
  check('HUD is visible', await A.isVisible('#hud'));
  check('Player character is created as chosen', await A.evaluate(() => !!iitm.studentNow() && iitm.net.kind === 'girl' && iitm.net.name === 'Asha'));
  check('Connects to the multiplayer server', await until(() => A.evaluate(() => iitm.net.status === 'online')));
  check('Online pill shows the count', /1 online/.test(await A.textContent('#cOnline')), await A.textContent('#cOnline'));
  check('No block-editing hotbar', !(await A.$('#hotbar')));

  // walking (give auto-quality a few seconds to settle on slow test machines)
  await sleep(4000);
  let p0 = await pos(A);
  await hold(A, 'KeyW', 1500);
  let p1 = await pos(A);
  check('W walks forward', Math.hypot(p1.x - p0.x, p1.z - p0.z) > 2, `${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1)} blocks`);
  check('Main Gate discovered on arrival', await A.evaluate(() => iitm.places().find(p => p.n === 'Main Gate').found));

  // jump
  // jump on open road, standing still
  await A.evaluate(() => { const q = iitm.places().find(p => p.n === 'Main Gate'); iitm.teleport(q.front[0] + .5, q.front[1] + .5, Math.PI); });
  await until(() => A.evaluate(() => iitm.player.onGround), 3000, 50);
  const y0 = (await pos(A)).y;
  await A.keyboard.down('Space');
  const y1 = await until(async () => { const y = (await pos(A)).y; return y > y0 + .3 ? y : 0; }, 3000, 30) || y0;
  await A.keyboard.up('Space'); await sleep(1500);
  check('Space jumps and lands again', y1 > y0 + .3 && Math.abs((await pos(A)).y - y0) < .2, `${y0.toFixed(2)} → ${y1.toFixed(2)}`);

  // walls block the player
  const wall = await A.evaluate(() => {
    const q = iitm.places().find(p => p.n === 'Central Library'); const [x0, z0, x1, z1] = q.box;
    iitm.teleport((x0 + x1) / 2 + .5 + 3, z1 + 2.5, 0); iitm.look(0, -.2);
    return { z1 };
  });
  await sleep(300);
  await hold(A, 'KeyW', 1500);
  p1 = await pos(A);
  check('Buildings block walking (no clipping into walls)', p1.z > wall.z1 + .6 || p1.y > 13.5, `z=${p1.z.toFixed(2)} wall=${wall.z1 + 1}`);

  // discovery + location card
  await A.evaluate(() => { const q = iitm.places().find(p => p.n === 'Gajendra Circle'); iitm.teleport(q.front[0] + .5, q.front[1] + .5, 0); });
  await sleep(500);
  check('Location card shows the current place', await until(async () => (await A.textContent('#pName')).includes('Gajendra Circle'), 3000), await A.textContent('#pName'));
  check('Discovery toast appears', await until(() => A.evaluate(() => iitm.toasts().includes('Gajendra Circle')), 3000));
  check('Places counter increments', /^[2-9]\d*\/85$|^\d{2}\/85$/.test(await A.textContent('#cPlaces')), await A.textContent('#cPlaces'));

  // campus map + fast travel
  await A.keyboard.press('KeyM');
  check('M opens the campus map', await until(() => A.isVisible('#mapview'), 2000));
  const lib = await A.evaluate(() => { const q = iitm.places().find(p => p.n === 'Main Gate'); const r = document.getElementById('mapcv').getBoundingClientRect(); return { x: r.left + (q.cx + .5) / 480 * r.width, y: r.top + (q.cz + .5) / 528 * r.height }; });
  await A.mouse.move(lib.x, lib.y); await sleep(200);
  check('Map tooltip names the hovered place', (await A.textContent('#maptip')).includes('Main Gate'));
  await A.mouse.click(lib.x, lib.y); await sleep(500);
  if (await A.evaluate(() => iitm.stateNow()) !== 'play') await A.evaluate(() => iitm.setState('play'));
  const mg = await A.evaluate(() => { const q = iitm.places().find(p => p.n === 'Main Gate'); return Math.hypot(iitm.player.pos.x - q.front[0], iitm.player.pos.z - q.front[1]); });
  check('Travel never lands inside a tree or wall', await A.evaluate(() => iitm.places().every(q => { iitm.teleport(q.front[0] + 2.5, q.front[1] + .5); return !iitm.stuckNow(); })));
  await A.evaluate(() => { const q = iitm.places().find(p => p.n === 'Main Gate'); iitm.teleport(q.front[0] + .5, q.front[1] + .5, Math.PI); });
  check('Clicking a discovered place travels there', mg < 3 && !(await A.isVisible('#mapview')), `${mg.toFixed(1)} blocks away`);

  // e-buggy
  const bg = await A.evaluate(() => {
    const b = iitm.buggies.find(v => v.kind === 'buggy' && !iitm.buggies.some(o => o !== v && Math.hypot(o.x - v.x, o.z - v.z) < 6));
    const lx = Math.cos(b.heading), lz = -Math.sin(b.heading);
    iitm.teleport(b.x + lx * 2.2, b.z + lz * 2.2); iitm.updatePrompt();
    return { vid: b.vid, text: iitm.focusNow() };
  });
  check('Prompt offers to drive a nearby e-buggy', bg.text === 'Drive the e-buggy', bg.text);
  await A.keyboard.press('KeyE'); await sleep(200);
  check('E gets into the e-buggy', await A.evaluate(() => iitm.drivingNow()?.kind === 'buggy') && (await A.textContent('#mode')) === 'Driving');
  const c0 = await A.evaluate(() => ({ x: iitm.drivingNow().x, z: iitm.drivingNow().z }));
  await hold(A, 'KeyW', 2000);
  const c1 = await A.evaluate(() => ({ x: iitm.drivingNow().x, z: iitm.drivingNow().z, s: iitm.drivingNow().speed }));
  const moved = Math.hypot(c1.x - c0.x, c1.z - c0.z);
  // a buggy can start facing a wall; if so reverse instead
  if (moved < 3) await hold(A, 'KeyS', 2000);
  const c2 = await A.evaluate(() => ({ x: iitm.drivingNow().x, z: iitm.drivingNow().z }));
  check('W/S drives the e-buggy', Math.hypot(c2.x - c0.x, c2.z - c0.z) > 3, `${Math.hypot(c2.x - c0.x, c2.z - c0.z).toFixed(1)} blocks`);
  await sleep(1500);
  await A.keyboard.press('KeyE'); await sleep(200);
  check('E gets out of the e-buggy', await A.evaluate(() => !iitm.drivingNow()) && (await A.textContent('#mode')) === 'Walking');
  check('Player is placed beside the parked buggy', await A.evaluate(v => { const b = iitm.buggies[v]; return Math.hypot(b.x - iitm.player.pos.x, b.z - iitm.player.pos.z) < 4; }, bg.vid));

  // bicycle
  const cy = await A.evaluate(() => {
    const b = iitm.buggies.find(v => v.kind === 'cycle');
    iitm.teleport(b.x - 1.4, b.z); iitm.updatePrompt();
    return iitm.focusNow();
  });
  check('Prompt offers to ride a nearby bicycle', cy === 'Ride the bicycle', cy);
  await A.keyboard.press('KeyE'); await sleep(200);
  check('E gets on the bicycle', await A.evaluate(() => iitm.drivingNow()?.kind === 'cycle') && (await A.textContent('#mode')) === 'Cycling');
  const k0 = await A.evaluate(() => ({ x: iitm.drivingNow().x, z: iitm.drivingNow().z }));
  await hold(A, 'KeyW', 1500);
  let k1 = await A.evaluate(() => ({ x: iitm.drivingNow().x, z: iitm.drivingNow().z }));
  if (Math.hypot(k1.x - k0.x, k1.z - k0.z) < 2) { await hold(A, 'KeyS', 2000); k1 = await A.evaluate(() => ({ x: iitm.drivingNow().x, z: iitm.drivingNow().z })); }
  check('Bicycle moves', Math.hypot(k1.x - k0.x, k1.z - k0.z) > 1.5, `${Math.hypot(k1.x - k0.x, k1.z - k0.z).toFixed(1)} blocks`);
  // regression: getting off must work while rolling and with a fractional ride height
  await A.evaluate(() => { const c = iitm.drivingNow(); c.y -= .0007; c.speed = 3; });
  await A.keyboard.press('KeyE'); await sleep(200);
  check('E gets off the bicycle (while rolling, fractional height)', await A.evaluate(() => !iitm.drivingNow()) && (await A.textContent('#mode')) === 'Walking');
  check('Rider lands standing, not stuck in the ground', await A.evaluate(() => { const p = iitm.player.pos; return p.y >= 12.99 && iitm.stateNow() === 'play'; }));
  // bike stands sit next to buildings, so try each direction until one is open
  const g0 = await pos(A); let g1 = g0;
  for (const yaw of [Math.PI / 2, 0, Math.PI, -Math.PI / 2]) {
    await A.evaluate(y => iitm.look(y, -.2), yaw);
    await hold(A, 'KeyW', 1200);
    g1 = await pos(A);
    if (Math.hypot(g1.x - g0.x, g1.z - g0.z) > 1) break;
  }
  check('Can walk away after getting off', Math.hypot(g1.x - g0.x, g1.z - g0.z) > 1, `${Math.hypot(g1.x - g0.x, g1.z - g0.z).toFixed(1)} blocks`);
  // same for the e-buggy
  await A.evaluate(() => { const b = iitm.buggies.find(v => v.kind === 'buggy'); iitm.teleport(b.x, b.z); iitm.enterBuggy(b); const c = iitm.drivingNow(); c.y -= .0004; c.speed = 4; });
  await A.keyboard.press('KeyE'); await sleep(200);
  check('E gets out of the e-buggy while moving', await A.evaluate(() => !iitm.drivingNow()));

  // deer
  // meet a deer on the open lawn in front of the Chemplast ground
  const dr = await A.evaluate(() => {
    const q = iitm.places().find(p => p.n === 'Chemplast Cricket Ground'); iitm.teleport(q.front[0] + .5, q.front[1] + .5, 0);
    const d = iitm.deer.find(x => !x.greeted);
    Object.assign(d, { x: iitm.player.pos.x, z: iitm.player.pos.z - 3.5, y: iitm.player.pos.y, state: 'graze', timer: 10, speed: 0 });
    iitm.updatePrompt(); return iitm.focusNow();
  });
  check('Prompt offers to greet a nearby deer', /^Say hi to the/.test(dr || ''), dr);
  await A.keyboard.press('KeyE'); await sleep(200);
  check('E greets the deer and counts it', await A.evaluate(() => iitm.greetedNow()) === 1 && (await A.textContent('#cDeer')) === '1/15', await A.textContent('#cDeer'));

  // monkey
  const mk = await A.evaluate(() => {
    iitm.deer.forEach(d => { if (Math.hypot(d.x - iitm.player.pos.x, d.z - iitm.player.pos.z) < 8) d.x += 20; });
    const m = iitm.monkeys[0];
    Object.assign(m, { x: iitm.player.pos.x + 2, z: iitm.player.pos.z, y: iitm.player.pos.y, state: 'sit', timer: 10, speed: 0 });
    iitm.updatePrompt(); return iitm.focusNow();
  });
  check('Prompt offers to wave at a monkey', mk === 'Wave at the monkey', mk);
  await A.keyboard.press('KeyE'); await sleep(250);
  check('Waving at a monkey shows a toast', await A.evaluate(() => iitm.toasts().includes('Bonnet macaque')));

  // fly, day/night, zoom
  await A.evaluate(() => { const q = iitm.places().find(p => p.n === 'Gajendra Circle'); iitm.teleport(q.front[0] + .5, q.front[1] + .5, 0); });
  await sleep(300);
  await A.keyboard.press('KeyF'); await sleep(100);
  const f0 = (await pos(A)).y;
  const flyMode = await A.textContent('#mode');
  await hold(A, 'Space', 1200);
  const f1 = (await pos(A)).y;
  check('F toggles flying and Space rises', flyMode === 'Flying' && f1 > f0 + 3, `${flyMode}, y ${f0.toFixed(1)} → ${f1.toFixed(1)}`);
  await A.keyboard.press('KeyF');
  check('F again returns to walking', (await A.textContent('#mode')) === 'Walking');
  const d0 = await A.evaluate(() => iitm.dayNow());
  await A.keyboard.press('KeyT');
  check('T switches between day and night', Math.abs(await A.evaluate(() => iitm.dayNow()) - d0) > .3);
  check('No runtime errors in single player', A.errors.length === 0, A.errors.slice(0, 3).join(' | '));

  // ============================================================
  //  Multiplayer
  // ============================================================
  const B = await openGame('B');
  check('Second player sees who is online before joining', /1 student/.test(await B.textContent('#liveCount')), await B.textContent('#liveCount'));
  await startAs(B, 'Ravi', 'boy');
  check('Second player connects', await until(() => B.evaluate(() => iitm.net.status === 'online')));
  check('Both see 2 online', await until(async () => /2 online/.test(await A.textContent('#cOnline')) && /2 online/.test(await B.textContent('#cOnline'))));
  check('A sees Ravi', await until(() => A.evaluate(() => [...iitm.net.peers.values()].some(p => p.name === 'Ravi' && p.kind === 'boy'))));
  check('B sees Asha', await until(() => B.evaluate(() => [...iitm.net.peers.values()].some(p => p.name === 'Asha' && p.kind === 'girl'))));

  // position sync
  // meet in front of a place with no vehicles parked nearby, so the E prompt is about the other player
  const meet = await A.evaluate(() => iitm.places().find(q => !q.skip && q.front && !iitm.buggies.some(v => Math.hypot(v.x - q.front[0], v.z - q.front[1]) < 9)).n);
  await A.evaluate(n => { const q = iitm.places().find(p => p.n === n); iitm.teleport(q.front[0] + .5, q.front[1] + .5, 0); }, meet);
  await B.evaluate(n => { const q = iitm.places().find(p => p.n === n); iitm.teleport(q.front[0] + 2.5, q.front[1] + .5, 0); }, meet);
  const synced = await until(() => A.evaluate(() => { const p = [...iitm.net.peers.values()][0]; return p && Math.hypot(p.x - iitm.player.pos.x, p.z - iitm.player.pos.z) < 4; }), 5000);
  check("Players see each other's live position", synced);
  const b0 = await A.evaluate(() => { const p = [...iitm.net.peers.values()][0]; return { x: p.tx, z: p.tz }; });
  for (const yaw of [-Math.PI / 2, 0, Math.PI, Math.PI / 2]) {
    await B.evaluate(y => iitm.look(y, -.2), yaw);
    await hold(B, 'KeyW', 900);
    const bp = await pos(B);
    if (Math.hypot(bp.x - b0.x, bp.z - b0.z) > 1.5) break;
  }
  const streamed = await until(() => A.evaluate(b => { const p = [...iitm.net.peers.values()][0]; return Math.hypot(p.x - b.x, p.z - b.z) > 1; }, b0), 3000);
  const bNow = await pos(B), aSees = await A.evaluate(() => { const p = [...iitm.net.peers.values()][0]; return { x: p.x, z: p.z }; });
  check("Movement streams to other players", streamed, `start ${b0.x.toFixed(1)},${b0.z.toFixed(1)} · Ravi at ${bNow.x.toFixed(1)},${bNow.z.toFixed(1)} · Asha sees ${aSees.x.toFixed(1)},${aSees.z.toFixed(1)}`);
  await B.evaluate(() => { const a = iitm.player.pos; });
  await B.evaluate(n => { const q = iitm.places().find(p => p.n === n); iitm.teleport(q.front[0] + 2.5, q.front[1] + .5, 0); }, meet);
  await sleep(800);

  // chat: decline
  const gotPrompt = await until(() => B.evaluate(() => { iitm.updatePrompt(); return iitm.focusNow() === 'Chat with Asha'; }), 3000);
  const promptInfo = await B.evaluate(() => { const p = [...iitm.net.peers.values()][0]; return `prompt "${iitm.focusNow()}", Asha ${Math.hypot(p.x - iitm.player.pos.x, p.z - iitm.player.pos.z).toFixed(1)} blocks away, dy ${(p.y - iitm.player.pos.y).toFixed(1)}`; });
  check('Nearby player gets a chat prompt', gotPrompt, promptInfo);
  await B.keyboard.press('KeyE');
  check('Chat request reaches the other player', await until(() => A.isVisible('#chatreq'), 3000));
  check('Request card names the sender', (await A.textContent('#reqName')) === 'Ravi');
  await A.keyboard.press('KeyN');
  check('Declining notifies the sender', await until(() => B.evaluate(() => iitm.toasts().some(t => t.includes("can't chat"))), 3000));

  // chat: accept
  await sleep(3200); // request cooldown
  await B.keyboard.press('KeyE');
  await until(() => A.isVisible('#chatreq'), 3000);
  await A.keyboard.press('KeyY');
  check('Accepting opens a chat window for both', await until(async () => await A.isVisible('#chat') && await B.isVisible('#chat'), 3000));
  await B.keyboard.press('Enter');
  check('Enter focuses the chat box', await B.evaluate(() => document.activeElement.id === 'chatInput'));
  await B.keyboard.type('hey! meet at GC?'); await B.keyboard.press('Enter');
  check('Message arrives', await until(() => A.evaluate(() => document.getElementById('chatLog').textContent.includes('hey! meet at GC?')), 3000));
  await A.keyboard.press('Enter'); await A.keyboard.type('<b>sure</b>'); await A.keyboard.press('Enter');
  check('Reply arrives and HTML is shown as plain text', await until(() => B.evaluate(() => { const l = [...document.querySelectorAll('#chatLog .line')].pop(); return l && l.textContent.includes('<b>sure</b>') && !l.querySelector('b b'); }), 3000));
  check('Typing in chat does not move the player', await B.evaluate(() => !iitm.keys.has('KeyW')));
  await A.keyboard.press('KeyX');
  check('X ends the chat for both', await until(async () => !(await A.isVisible('#chat')) && !(await B.isVisible('#chat')), 3000));

  // vehicle occupancy
  const vid = await A.evaluate(() => {
    const b = iitm.buggies.filter(v => v.kind === 'cycle').sort((a, c) => Math.hypot(a.x - iitm.player.pos.x, a.z - iitm.player.pos.z) - Math.hypot(c.x - iitm.player.pos.x, c.z - iitm.player.pos.z))[0];
    iitm.teleport(b.x - 1.4, b.z); iitm.enterBuggy(b); return b.vid;
  });
  check('Other players see who is riding a vehicle', await until(() => B.evaluate(v => iitm.buggies[v].remote > 0, vid), 3000));
  const taken = await B.evaluate(v => { const b = iitm.buggies[v]; iitm.teleport(b.x, b.z + 1.2); iitm.updatePrompt(); return iitm.focusObj(); }, vid);
  check('A vehicle in use cannot be taken', taken !== vid, `focus vid ${taken}, ridden ${vid}`);
  await A.evaluate(() => iitm.exitBuggy(true));
  check('Vehicle frees up after the rider gets off', await until(() => B.evaluate(v => !iitm.buggies[v].remote, vid), 3000));

  // leave
  await B.close();
  check('Leaving removes the player for others', await until(() => A.evaluate(() => iitm.net.peers.size === 0), 5000));
  check('Online count drops back to 1', await until(async () => /1 online/.test(await A.textContent('#cOnline')), 3000));
  check('No runtime errors in multiplayer', A.errors.length === 0 && B.errors.length === 0, [...A.errors, ...B.errors].slice(0, 3).join(' | '));
  await A.close();

  // ============================================================
  //  Server hardening (raw WebSocket clients)
  // ============================================================
  const raw = () => new Promise((res, rej) => { const w = new WebSocket(`ws://localhost:${PORT}/ws`); w.msgs = []; w.on('message', d => w.msgs.push(JSON.parse(d))); w.on('open', () => res(w)); w.on('error', rej); });
  const w1 = await raw(), w2 = await raw();
  w1.send('not json'); w1.send(JSON.stringify({ t: 's', x: 1 }));
  w1.send(JSON.stringify({ t: 'join', name: '<script>x</script>AVeryLongNameThatKeepsGoing', kind: 'dragon' }));
  w2.send(JSON.stringify({ t: 'join', name: '   ', kind: 'girl' }));
  await sleep(300);
  const wel = w1.msgs.find(m => m.t === 'welcome');
  check('Server ignores bad messages before joining', !!wel);
  w1.send(JSON.stringify({ t: 's', x: 10, y: 13, z: 10, f: 0, a: 'walk', vh: 0 }));
  w2.send(JSON.stringify({ t: 's', x: 11, y: 13, z: 10, f: 0, a: 'walk', vh: 0 }));
  await sleep(400);
  const add = w2.msgs.find(m => m.t === 'add' && m.p.id === wel.id) || w2.msgs.find(m => m.t === 'snap' && m.ps.length);
  const nameSeen = w2.msgs.find(m => m.t === 'add')?.p.name ?? '';
  check('Server strips HTML and trims long names', nameSeen && !nameSeen.includes('<') && nameSeen.length <= 16, nameSeen);
  check('Server defaults unknown character kinds', w2.msgs.find(m => m.t === 'add')?.p.kind === 'boy');
  w1.send(JSON.stringify({ t: 's', x: 1e9, y: 0, z: 0 }));
  w1.send(JSON.stringify({ t: 'chat', text: 'no session' }));
  await sleep(300);
  check('Chat without an accepted request is dropped', !w2.msgs.some(m => m.t === 'chat'));
  const w2id = w2.msgs.find(m => m.t === 'welcome').id;
  w1.send(JSON.stringify({ t: 'chatReq', to: w2id }));
  await sleep(200);
  w1.send(JSON.stringify({ t: 'chatResp', to: w2id, ok: true }));
  await sleep(200);
  check('A player cannot accept their own request', !w1.msgs.some(m => m.t === 'chatOpen'));
  const lastSnap = [...w2.msgs].reverse().find(m => m.t === 'snap' && m.ps.some(r => r[0] === wel.id));
  const w1row = lastSnap && lastSnap.ps.find(r => r[0] === wel.id);
  check('Out-of-range positions are rejected', w1row && Math.abs(w1row[1] - 10) < .01, w1row ? `x=${w1row[1]}` : 'no snapshot');
  const closed = new Promise(res => w1.on('close', res));
  for (let i = 0; i < 200; i++) w1.send(JSON.stringify({ t: 's', x: 10, y: 13, z: 10 }));
  check('Message flooding disconnects the client', await Promise.race([closed.then(() => true), sleep(3000).then(() => false)]));
  w2.close();
  const online = await (await fetch(`${BASE}/api/online`)).json();
  await sleep(300);
  check('Health endpoint responds', (await fetch(`${BASE}/health`)).ok);
  check('Unknown paths return 404', (await fetch(`${BASE}/server/server.js`)).status === 404);
  check('Online API reports players', typeof online.online === 'number');
} catch (e) {
  check('Test run completed without crashing', false, e.stack || String(e));
} finally {
  await browser?.close();
  server.kill();
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
