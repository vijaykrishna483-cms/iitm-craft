#!/usr/bin/env node
// Deploy IITM Craft without dropping players on the floor.
//
//   npm run deploy                 push main, trigger the deploy, wait until the new build is live
//   npm run deploy -- --quiet-at 2 wait until 2 or fewer players are online first (up to 30 min)
//   npm run deploy -- --check      just report what is live and who is online, change nothing
//
// The deploy hook comes from DEPLOY_HOOK, or scripts/.deploy-hook (untracked). Get it from
// Render: the service -> Settings -> Deploy Hook. Without it the script tells you what to click.
//
// Players are not disconnected silently: the server catches SIGTERM and tells everyone it is a
// quick update, and the game reconnects on its own within a few seconds while the campus keeps
// running on their screen. Nobody has to reload.

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = process.env.SITE || 'https://iitm-craft.online';
const args = process.argv.slice(2);
const flag = n => args.includes(n);
const val = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i+1] ? args[i+1] : d; };

const sh = c => execSync(c, { cwd: join(HERE, '..'), encoding: 'utf8' }).trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = async path => {
  const r = await fetch(SITE + path, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json();
};
const hook = () => process.env.DEPLOY_HOOK
  || (existsSync(join(HERE, '.deploy-hook')) ? readFileSync(join(HERE, '.deploy-hook'), 'utf8').trim() : '');

const live = async () => { try { return await get('/api/version'); } catch { return null; } };
const online = async () => { try { return (await get('/api/online')).online; } catch { return null; } };

const head = sh('git rev-parse --short HEAD');
const branch = sh('git rev-parse --abbrev-ref HEAD');
const dirty = sh('git status --porcelain');

console.log(`local   ${branch} @ ${head}${dirty ? ' (uncommitted changes!)' : ''}`);
const before = await live();
console.log(`live    ${before ? `${before.commit}, up ${before.uptime}s, ${before.online} online` : 'could not read /api/version (old build, or the site is down)'}`);

if (flag('--check')) process.exit(0);
if (dirty) { console.error('\nCommit or stash your changes first — deploying would ship something you have not committed.'); process.exit(1); }

// 1. Wait for a quiet moment, if asked.
const quietAt = val('--quiet-at', null);
if (quietAt !== null) {
  const want = Number(quietAt), until = Date.now() + 30*60*1000;
  let n = await online();
  while (n !== null && n > want && Date.now() < until) {
    console.log(`waiting for a quiet moment: ${n} online, want <= ${want}`);
    await sleep(60000);
    n = await online();
  }
  if (n !== null && n > want) console.log(`still ${n} online after 30 min — going ahead anyway`);
}

// 2. Push.
console.log(`\npushing ${branch}...`);
try { console.log(sh(`git push origin ${branch}`) || 'pushed'); }
catch (e) { console.error('push failed:\n' + (e.stdout || '') + (e.stderr || '')); process.exit(1); }

// 3. Trigger the deploy. Render has no webhook on this repo, so a push alone does nothing.
const h = hook();
if (!h) {
  console.error(`
The commit is on GitHub but nothing will deploy: this repo has no Render webhook,
so pushes are not picked up automatically.

Fix it once, either way:
  a) Render dashboard -> iitm-craft -> Settings -> Deploy Hook -> copy the URL, then
     save it in scripts/.deploy-hook (it is gitignored) and re-run this script; or
  b) Render dashboard -> iitm-craft -> Settings -> reconnect the GitHub repo, which
     installs the webhook and makes autoDeploy work on its own.

For right now: Render dashboard -> iitm-craft -> Manual Deploy -> Deploy latest commit.`);
  process.exit(2);
}
console.log('triggering the deploy...');
const r = await fetch(h, { method: 'POST' });
console.log(`deploy hook -> ${r.status} ${r.ok ? 'accepted' : await r.text()}`);
if (!r.ok) process.exit(1);

// 4. Wait for the new build to actually serve, and say what players went through.
console.log(`\nwaiting for ${head} to go live (builds take a few minutes)...`);
const start = Date.now();
let seenDown = false;
for (let i = 0; i < 120; i++) {
  await sleep(10000);
  const v = await live();
  const secs = Math.round((Date.now() - start)/1000);
  if (!v) { seenDown = true; console.log(`  ${secs}s  restarting...`); continue; }
  if (v.commit === head) {
    console.log(`\nlive: ${head} after ${secs}s, ${v.online} online.`);
    console.log(seenDown ? 'Players saw "Updating" for a few seconds and reconnected by themselves.' : 'No gap observed from here.');
    process.exit(0);
  }
  console.log(`  ${secs}s  still ${v.commit} (up ${v.uptime}s)`);
}
console.error(`\n${head} is still not live after 20 minutes. Check the Render dashboard for a failed build.`);
process.exit(1);
