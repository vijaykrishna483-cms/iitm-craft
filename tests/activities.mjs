// End-to-end tests for the social features and mini-games, with three players on a local server.
// Run: npm run test:activities
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 19000 + Math.floor(Math.random() * 900), BASE = `http://localhost:${PORT}`;
const results = []; let failed = 0;
const check = (name, ok, detail = '') => { results.push(name); if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 5000, step = 100){ const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(step); } return fn(); }

const server = spawn(process.execPath, ['server/server.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
server.stderr.on('data', d => process.stderr.write('[server] ' + d));
await Promise.race([new Promise(res => server.stdout.on('data', d => { if (String(d).includes('running')) res(); })), sleep(8000)]);
const opts = { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };
let browser; try { browser = await chromium.launch({ channel: 'chrome', ...opts }); } catch { browser = await chromium.launch(opts); }

async function player(name, kind, prof){
  const p = await browser.newPage({ viewport: { width: 960, height: 540 } });
  p.errors = [];
  p.on('pageerror', e => p.errors.push(`${name}: ${e.message}`));
  p.on('console', m => { if (m.type() === 'error' && !/status of 503/.test(m.text())) p.errors.push(`${name}: ${m.text()}`); });
  await p.goto(`${BASE}/?debug`);
  await p.waitForSelector('#start:not(.hidden)', { timeout: 180000 });
  if (prof) await p.evaluate(pr => localStorage.setItem('iitmcraft.prof', JSON.stringify(pr)), prof);
  if (prof) { await p.reload(); await p.waitForSelector('#start:not(.hidden)', { timeout: 180000 }); }
  await p.fill('#nameInput', name);
  await p.evaluate(k => { document.querySelector(`.who[data-kind="${k}"]`).click(); document.getElementById('bStart').click(); }, kind); await sleep(300);
  if (await p.evaluate(() => iitm.stateNow()) !== 'play') await p.evaluate(() => iitm.setState('play'));
  await until(() => p.evaluate(() => iitm.net.status === 'online'), 8000);
  return p;
}
const pos = p => p.evaluate(() => ({ x: iitm.player.pos.x, y: iitm.player.pos.y, z: iitm.player.pos.z }));

try {
  const A = await player('Asha', 'girl', { h: 'Sarayu', y: '2nd year', d: 'Computer Science', i: ['Music', 'Chai'] });
  const B = await player('Ravi', 'boy');
  const C = await player('Meera', 'girl');
  check('Three players connect', await until(() => A.evaluate(() => iitm.net.peers.size === 2), 8000));

  // ---------- profiles ----------
  // meet somewhere with no vehicles or activities nearby, so the prompt is about the other player
  const meet = await A.evaluate(() => iitm.places().find(q => !q.skip && q.front && !iitm.buggies.some(v => Math.hypot(v.x - q.front[0], v.z - q.front[1]) < 9) && !/Football|Cricket|Pool|Cafe|Café|Lake|Circle|Theatre/.test(q.n)).n);
  await A.evaluate(n => { const q = iitm.places().find(p => p.n === n); iitm.teleport(q.front[0] + .5, q.front[1] + .5, 0); }, meet);
  await B.evaluate(n => { const q = iitm.places().find(p => p.n === n); iitm.teleport(q.front[0] + 2.5, q.front[1] + .5, 0); }, meet);
  await sleep(1200);
  const card = await until(() => B.evaluate(() => { iitm.updatePrompt(); return !document.getElementById('pcard').hidden && document.getElementById('pcard').textContent; }), 4000);
  check('Walking up to someone shows their mini profile', /Sarayu hostel/.test(card || '') && /Computer Science/.test(card || '') && /Music/.test(card || ''), String(card).slice(0, 80) + ' ' + JSON.stringify(await B.evaluate(() => ({ focus: iitm.focusNow(), profs: [...iitm.net.peers.values()].map(p => [p.name, p.prof]) }))) + ' sent=' + JSON.stringify(await A.evaluate(() => JSON.parse(localStorage.getItem('iitmcraft.prof') || 'null'))));

  // ---------- emotes ----------
  await A.keyboard.press('Digit1');
  check('Emote keys play an emote', await A.evaluate(() => iitm.act().emote && iitm.act().emote.e === 'wave'));
  check('Other players see your emote', await until(() => B.evaluate(() => [...iitm.net.peers.values()].some(p => p.name === 'Asha' && p.emote && p.emote.e === 'wave')), 3000));

  // ---------- event board ----------
  await A.evaluate(() => { const b = iitm.board(); iitm.teleport(b.x + Math.sin(Math.atan2(b.x - b.cx - .5, b.z - b.cz - .5)) * 2, b.z + Math.cos(Math.atan2(b.x - b.cx - .5, b.z - b.cz - .5)) * 2); });
  await sleep(400);
  const bf = await A.evaluate(() => { iitm.updatePrompt(); return iitm.focusNow(); });
  check('The GC notice board offers what\'s on', bf === "See what's on", String(bf));
  await A.keyboard.press('KeyE'); await sleep(300);
  check('Board opens the events list with every activity', await A.isVisible('#events') && await A.evaluate(() => document.querySelectorAll('#evList .evrow').length === 6));
  await A.click('#evList .evrow:first-child button'); await sleep(500);
  if (await A.evaluate(() => iitm.stateNow()) !== 'play') await A.evaluate(() => iitm.setState('play'));
  check('Go on the board takes you to the football ground', await A.evaluate(() => { const q = iitm.places().find(p => p.n === 'Football Ground'); return Math.hypot(iitm.player.pos.x - q.front[0], iitm.player.pos.z - q.front[1]) < 4; }));

  // ---------- football ----------
  const ball0 = await B.evaluate(() => ({ x: iitm.fbBall().x, z: iitm.fbBall().z }));
  await A.evaluate(() => { const f = iitm.fbBall(); iitm.teleport(f.pitch.x0 + f.x, f.pitch.z0 + f.z + 1); iitm.look(0, -.2); });
  await sleep(500);
  const kf = await A.evaluate(() => { iitm.updatePrompt(); return iitm.focusNow(); });
  check('Standing by the ball offers a kick', kf === 'Kick the ball', String(kf));
  await A.keyboard.press('KeyE');
  check('A kick moves the shared ball for other players', await until(() => B.evaluate(b => Math.hypot(iitm.fbBall().x - b.x, iitm.fbBall().z - b.z) > 2, ball0), 3000));
  check('A hard shot into the goal scores for everyone', await until(() => B.evaluate(() => iitm.fbBall().b === 1), 5000), JSON.stringify(await B.evaluate(() => ({ a: iitm.fbBall().a, b: iitm.fbBall().b }))));
  check('Ball goes back to the centre after a goal', await until(() => B.evaluate(() => Math.abs(iitm.fbBall().z - 10.5) < .2 && Math.abs(iitm.fbBall().x - 6.5) < .2), 5000));

  // ---------- café tables ----------
  const seat = await A.evaluate(() => { const s = iitm.cafes()[0].tables[0].seats[0]; iitm.teleport(s.x, s.z + .4); return s; });
  await sleep(400);
  const sf = await A.evaluate(() => { iitm.updatePrompt(); return iitm.focusNow(); });
  check('Café chairs offer a seat', sf === 'Sit at the table', String(sf));
  await A.keyboard.press('KeyE'); await sleep(300);
  check('Sitting down seats you at the table', await A.evaluate(() => !!iitm.act().seated) && (await A.textContent('#mode')) === 'Sitting');
  check('Others see the seat taken', await until(() => B.evaluate(() => (iitm.act().tables.get('usha-0') || [])[0] > 0), 3000));
  await B.evaluate(() => { const s = iitm.cafes()[0].tables[0].seats[1]; iitm.teleport(s.x + .3, s.z); });
  await C.evaluate(() => { const s = iitm.cafes()[0].tables[1].seats[0]; iitm.teleport(s.x, s.z + 2); });
  await sleep(500);
  await B.evaluate(() => iitm.updatePrompt()); await B.keyboard.press('KeyE'); await sleep(400);
  check('A second student sits at the same table', await B.evaluate(() => iitm.act().seated && iitm.act().seated.t.tid === 'usha-0'));
  await A.keyboard.press('Enter');
  check('Chat box switches to table chat when seated', (await A.textContent('#sayBar .chip')) === 'Table');
  await A.keyboard.type('chai anyone?'); await A.keyboard.press('Enter');
  check('Table chat reaches people at your table', await until(() => B.evaluate(() => /chai anyone\?/.test(document.getElementById('feedLog').textContent)), 3000));
  await sleep(600);
  check('Table chat stays private from the next table', !(await C.evaluate(() => /chai anyone\?/.test(document.getElementById('feedLog').textContent))));
  check('Seated students show sitting to others', await until(() => C.evaluate(() => [...iitm.net.peers.values()].some(p => p.name === 'Asha' && p.a === 'sit')), 3000));
  await A.keyboard.press('KeyE'); await sleep(300);
  check('E stands you up and frees the seat', await A.evaluate(() => !iitm.act().seated) && await until(() => C.evaluate(() => !(iitm.act().tables.get('usha-0') || [])[0]), 3000));
  await B.keyboard.press('KeyE');

  // ---------- fishing ----------
  const fishSpot = await A.evaluate(() => {
    iitm.crocList().forEach(k => { k.x = -1000; k.z = -1000; });            // keep crocodiles out of this test
    const q = iitm.places().find(p => p.n === 'Campus Lake');
    for (let r = 20; r < 45; r++) for (let a = 0; a < 6.28; a += .1) {
      const x = q.cx + Math.cos(a) * r, z = q.cz + Math.sin(a) * r;
      if (['Sand', 'Grass'].includes(iitm.blockInfo(x, 13, z).below) && iitm.lakeTileNear(x, z) && !iitm.blockInfo(x, 13, z).insideSolid) { iitm.teleport(x, z); return [x, z]; }
    }
    return null;
  });
  await C.evaluate(s => iitm.teleport(s[0] + 7, s[1]), fishSpot);
  await sleep(500);
  const ff = await A.evaluate(() => { iitm.updatePrompt(); return iitm.focusNow(); });
  check('Standing at the lake edge offers fishing', ff === 'Fish here', String(ff));
  await A.keyboard.press('KeyE'); await sleep(200);
  check('Casting the line starts fishing', await A.evaluate(() => iitm.act().fishing && iitm.act().fishing.phase === 'wait'));
  await A.evaluate(() => { iitm.act().fishing.t = 0; });
  check('A fish bites', await until(() => A.evaluate(() => iitm.act().fishing && iitm.act().fishing.phase === 'bite'), 2000));
  await A.keyboard.press('KeyE');
  check('Reeling shows the reel bar', await until(() => A.isVisible('#reel'), 1000));
  await A.evaluate(() => { const f = iitm.act().fishing; f.zone = (Math.sin(f.t * 3.4) + 1) / 2; });
  await A.keyboard.press('KeyE');
  check('Stopping in the green lands the fish', await until(() => A.evaluate(() => iitm.toasts().some(t => /^You caught a/.test(t))), 2000));
  check('Nearby players hear about the catch', await until(() => C.evaluate(() => /Asha caught a/.test(document.getElementById('feedLog').textContent)), 3000));
  check('Biggest catch shows up in the records', await until(() => B.evaluate(() => iitm.act().rec && iitm.act().rec.fish && iitm.act().rec.fish.name === 'Asha'), 3000));

  // ---------- box cricket ----------
  await A.evaluate(() => { const n = iitm.nets(); iitm.teleport(n.bx, n.bz + 1.2); });
  await sleep(400);
  const cf = await A.evaluate(() => { iitm.updatePrompt(); return iitm.focusNow(); });
  check('The batting crease offers an over', cf === 'Face an over (box cricket)', String(cf));
  await A.keyboard.press('KeyE'); await sleep(200);
  check('Facing an over starts batting', await A.evaluate(() => !!iitm.act().batting));
  // swing on time for the first ball
  await until(() => A.evaluate(() => { const b = iitm.act().batting; return b && b.phase === 'ball' && b.t > b.dur - .03; }), 5000, 10);
  await A.keyboard.press('KeyE');
  check('A well-timed swing scores runs', await until(() => A.evaluate(() => iitm.act().batting && iitm.act().batting.balls >= 1), 3000) && await A.evaluate(() => iitm.act().batting.runs > 0), JSON.stringify(await A.evaluate(() => iitm.act().batting && { runs: iitm.act().batting.runs, last: iitm.act().batting.last })));
  check('The over finishes after six balls', await until(() => A.evaluate(() => !iitm.act().batting), 40000, 250) && await A.evaluate(() => iitm.toasts().some(t => /^Over complete/.test(t))));
  check('Best over shows up in the records', await until(() => B.evaluate(() => iitm.act().rec && iitm.act().rec.over && iitm.act().rec.over.name === 'Asha'), 3000));

  // ---------- swim race ----------
  for (const [p, dz] of [[A, 0], [B, 4.5]]) await p.evaluate(dz => { const r = iitm.poolR(); iitm.teleport(r.x0 - 1, (r.z0 + r.z1) / 2 + dz); }, dz);
  await sleep(500);
  const wf = await A.evaluate(() => { iitm.updatePrompt(); return iitm.focusNow(); });
  check('The pool offers a swim race', /swim race/.test(wf || ''), String(wf));
  await A.keyboard.press('KeyE'); await sleep(300);
  await B.evaluate(() => iitm.updatePrompt()); await B.keyboard.press('KeyE');
  check('Two swimmers get lanes in the water', await until(() => B.evaluate(() => iitm.race().lanes.length === 2 && iitm.act().swim && iitm.act().swim.phase === 'lobby'), 3000));
  check('A countdown shows before the start', await A.isVisible('#raceHud') && /Race starts in|Get ready/.test(await A.textContent('#raceHud')));
  check('The race starts for everyone', await until(() => A.evaluate(() => iitm.act().swim && iitm.act().swim.phase === 'go'), 12000));
  for (const [p, d] of [[A, 4600], [B, 5400]]) {
    await p.evaluate(() => { const r = iitm.poolR(); iitm.player.pos.x = r.x1 - .8; });
    await sleep(d);
    await p.evaluate(() => { const r = iitm.poolR(); iitm.player.pos.x = r.x0 + 1; });
  }
  check('Finishing sends your time and the race shows results', await until(() => A.evaluate(() => iitm.toasts().includes('Results')), 8000));
  check('The winner is listed first', await A.evaluate(() => iitm.race().results[0] && iitm.race().results[0].name === 'Asha'), JSON.stringify(await A.evaluate(() => iitm.race().results)));

  // ---------- OAT lights ----------
  const r1 = await A.evaluate(() => { const q = iitm.places().find(p => p.n === 'Open Air Theatre'); iitm.teleport(q.cx + .5, q.cz + 4); return iitm.oatRig().heads[0].rotation.z; });
  await sleep(600);
  check('OAT stage lights are animating', await A.evaluate(r => Math.abs(iitm.oatRig().heads[0].rotation.z - r) > .001, r1));

  check('No runtime errors for any player', !A.errors.length && !B.errors.length && !C.errors.length, [...A.errors, ...B.errors, ...C.errors].slice(0, 3).join(' | '));
} catch (e) {
  check('Test run completed without crashing', false, e.stack || String(e));
} finally {
  await browser?.close(); server.kill();
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
