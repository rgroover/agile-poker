import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

let browser, server, origin;
let serverLog = '';
const browserErrors = [];
const screenshots = new URL('../test-results/', import.meta.url);

before(async () => {
  const portServer = createServer();
  await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve));
  const port = portServer.address().port;
  await new Promise(resolve => portServer.close(resolve));
  origin = process.env.TEST_BASE_URL || `http://127.0.0.1:${port}`;
  if (!process.env.TEST_BASE_URL) {
    server = spawn(process.env.DOTNET_BIN || 'dotnet', ['bin/Release/net10.0/AgilePoker.dll', '--urls', origin], {
      cwd: new URL('..', import.meta.url), stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ASPNETCORE_ENVIRONMENT: 'Production' }
    });
    server.stdout.on('data', data => { serverLog += data; });
    server.stderr.on('data', data => { serverLog += data; });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if ((await fetch(`${origin}/health`)).ok) { ready = true; break; } } catch { /* Wait for startup. */ }
      if (server.exitCode !== null) throw new Error(serverLog);
      await delay(100);
    }
    assert.ok(ready, `Server failed to start: ${serverLog}`);
  }
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  await mkdir(screenshots, { recursive: true });
});
after(async () => {
  await browser?.close();
  if (server && server.exitCode === null) {
    const exited = new Promise(resolve => server.once('exit', resolve));
    server.kill('SIGTERM');
    await exited;
  }
});

async function pageFor(t, viewport = { width: 1440, height: 1050 }) {
  const context = await browser.newContext({ viewport });
  t.after(() => context.close());
  const page = await context.newPage();
  page.on('pageerror', error => browserErrors.push(error.message));
  return page;
}

async function createRoom(playerName = 'Alex', options = {}) {
  const response = await fetch(`${origin}/api/rooms`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerName, name: 'Sprint 24 planning', deck: 'fibonacci', ...options })
  });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

async function openRoom(page, credentials) {
  await page.goto(origin);
  await page.evaluate(({ roomId, token }) => sessionStorage.setItem(`room:${roomId}`, token), credentials);
  await page.goto(`${origin}/room/${credentials.roomId}`);
  await page.waitForSelector('.workspace');
}

async function joinGuest(page, roomId, name = 'Sam', spectator = false) {
  await page.goto(`${origin}/room/${roomId}`);
  await page.getByLabel('Your name', { exact: false }).fill(name);
  if (spectator) await page.getByRole('checkbox', { name: 'Join as a spectator' }).check();
  await page.getByRole('button', { name: 'Join session', exact: true }).click();
  await page.waitForSelector('.workspace');
}

async function wire(page, credentials, name = 'Wire client', spectator = false) {
  await page.goto(origin);
  return page.evaluate(async ({ credentials, name, spectator }) => {
    window.snapshots = [];
    window.testConnection = new signalR.HubConnectionBuilder().withUrl('/hubs/poker').build();
    window.testConnection.on('RoomUpdated', view => { window.snapshots.push(view); window.snapshot = view; });
    await window.testConnection.start();
    return window.testConnection.invoke('Join', { roomId: credentials.roomId, token: credentials.token, name, spectator });
  }, { credentials, name, spectator });
}
const hub = (page, method, ...args) => page.evaluate(({ method, args }) => window.testConnection.invoke(method, ...args), { method, args });
const state = page => page.evaluate(() => window.snapshot);
async function waitVersion(page, version) { await page.waitForFunction(version => window.snapshot?.version > version, version); }

test('start-session, invite, vote, reveal, and next-round flow work on desktop and mobile', async t => {
  const host = await pageFor(t);
  await host.goto(origin);
  assert.equal(await host.getByRole('tab', { name: 'Start a Session', exact: true }).getAttribute('aria-selected'), 'true');
  assert.equal(await host.locator('.hero-copy').count(), 0);
  await host.screenshot({ path: new URL('landing-desktop.png', screenshots).pathname, fullPage: true });
  await host.getByLabel('Your name', { exact: false }).fill('Alex');
  await host.getByLabel('Session name', { exact: false }).fill('Sprint 24 planning');
  await host.getByRole('button', { name: 'Start a Session', exact: true }).click();
  await host.waitForSelector('.workspace');
  await host.waitForURL(/\/room\/[A-F0-9]{8}$/);
  const roomId = new URL(host.url()).pathname.split('/').at(-1);
  assert.match(roomId, /^[A-F0-9]{8}$/);
  const mobile = await pageFor(t, { width: 390, height: 844 });
  await joinGuest(mobile, roomId, 'Sam');
  assert.equal(await host.locator('.sidebar').count(), 0);
  const mobileCard = await mobile.getByRole('button', { name: 'Estimate 8', exact: true }).boundingBox();
  assert.ok(mobileCard.y + mobileCard.height <= 844, 'Voting cards are visible immediately after joining on mobile');
  await mobile.getByRole('button', { name: 'Estimate 8', exact: true }).click();
  await host.locator('.vote-progress').filter({ hasText: '1 of 2' }).waitFor();
  await host.getByRole('button', { name: 'Estimate 5', exact: true }).click();
  await host.locator('[data-vote="5"][aria-pressed="true"]:enabled').waitFor();
  await host.screenshot({ path: new URL('room-desktop.png', screenshots).pathname, fullPage: true });
  await mobile.screenshot({ path: new URL('room-mobile.png', screenshots).pathname, fullPage: true });
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Mobile page must not overflow horizontally');
  await host.getByRole('button', { name: 'Reveal cards' }).click();
  await mobile.getByText('All cards are now visible', { exact: true }).waitFor();
  await host.screenshot({ path: new URL('results-desktop.png', screenshots).pathname, fullPage: true });
  await host.getByRole('button', { name: 'Next round', exact: true }).click();
  await host.getByRole('heading', { name: 'Round 2', exact: true }).waitFor();
  assert.equal(await host.locator('dialog[open]').count(), 0, 'Next round starts immediately without a setup dialog');
  await host.getByRole('button', { name: 'Edit round topic', exact: true }).click();
  await host.getByRole('textbox', { name: 'Round topic', exact: false }).fill('PROJ-42 · A smoother checkout');
  await host.getByRole('button', { name: 'Save topic' }).click();
  await mobile.getByRole('heading', { name: 'PROJ-42 · A smoother checkout', exact: true }).waitFor();
  await mobile.reload();
  await mobile.waitForSelector('.workspace');
  assert.equal(await mobile.locator('.team-member').count(), 2, 'Refresh resumes the same seat');
  await host.getByRole('button', { name: 'Leave session', exact: true }).click();
  await host.locator('#accept-confirm').click();
  await host.waitForSelector('.landing');
  await mobile.getByRole('button', { name: 'Session settings' }).waitFor();
  await mobile.getByRole('button', { name: 'Leave session', exact: true }).click();
  await mobile.locator('#accept-confirm').click();
  await mobile.waitForSelector('.landing');
});

test('hidden votes are redacted on the wire; host permissions and statistics hold', async t => {
  const credentials = await createRoom();
  const host = await pageFor(t), guest = await pageFor(t);
  await wire(host, credentials);
  await wire(guest, { roomId: credentials.roomId });
  await hub(host, 'Vote', '5');
  await guest.waitForFunction(() => window.snapshot.members.some(m => m.hasVoted));
  let view = await state(guest);
  assert.equal(view.members.find(m => m.isHost).vote, null);
  assert.equal(view.history.length, 0);
  assert.equal((await state(host)).members.find(m => m.isHost).vote, '5');
  for (const method of ['Reveal', 'RestartRound', 'NextRound', 'SetTopic', 'SetTimer', 'UpdateSettings']) {
    const args = { NextRound: ['new'], SetTopic: ['new'], SetTimer: [60], UpdateSettings: [{ name: 'Hijacked', deck: 'tshirt', autoReveal: false }] }[method] || [];
    await assert.rejects(hub(guest, method, ...args), /Only the session host/);
  }
  await assert.rejects(hub(guest, 'Vote', '999'), /Choose a card/);
  await hub(guest, 'Vote', '8');
  await hub(host, 'Reveal');
  await guest.waitForFunction(() => window.snapshot.revealed);
  view = await state(guest);
  assert.deepEqual(view.members.map(m=>m.vote), ['5','8']);
  assert.equal(view.history[0].average, 6.5);
  assert.equal(view.history[0].median, 6.5);
  assert.equal(view.history[0].consensus, null);
  await assert.rejects(hub(guest, 'Vote', '3'), /round is revealed/);
  await hub(host, 'RestartRound');
  await guest.waitForFunction(() => !window.snapshot.revealed);
  view = await state(guest);
  assert.ok(view.members.every(m=>m.vote === null && !m.hasVoted));
  assert.equal(view.history.length, 0);
});

test('spectators, automatic reveal, deck changes, and nonnumeric statistics', async t => {
  const credentials = await createRoom('Alex', { deck: 'tshirt', autoReveal: true });
  const host = await pageFor(t), spectator = await pageFor(t);
  await wire(host, credentials);
  await wire(spectator, { roomId: credentials.roomId }, 'Observer', true);
  await assert.rejects(hub(spectator, 'Vote', 'M'), /Spectators cannot vote/);
  await hub(host, 'Vote', 'M');
  await spectator.waitForFunction(() => window.snapshot.revealed);
  let view = await state(spectator);
  assert.equal(view.history[0].consensus, 'M');
  assert.equal(view.history[0].average, null);
  assert.equal(view.history[0].median, null);
  await hub(host, 'NextRound', 'Another story');
  await hub(host, 'UpdateSettings', { name: 'New session name', deck: 'powers', autoReveal: false });
  await spectator.waitForFunction(() => window.snapshot.deck === 'powers');
  assert.equal((await state(spectator)).history.length, 1);
  await hub(host, 'Vote', '32');
  await assert.rejects(hub(host, 'UpdateSettings', { name: 'New session name', deck: 'fibonacci', autoReveal: false }), /Reset the round/);
  await hub(host, 'Vote', null);
  await hub(host, 'UpdateSettings', { name: 'New session name', deck: 'fibonacci', autoReveal: false });
  await hub(host, 'Vote', '½');
  await hub(host, 'Reveal');
  assert.equal((await state(host)).history.at(-1).average, 0.5);
});

test('disconnect/rejoin preserves identity and vote, and transfers host', async t => {
  const credentials = await createRoom();
  const host = await pageFor(t), guest = await pageFor(t);
  await wire(host, credentials);
  const guestCredentials = await wire(guest, { roomId: credentials.roomId }, 'Sam');
  const guestId = (await state(guest)).you;
  await hub(guest, 'Vote', '3');
  await guest.evaluate(() => window.testConnection.stop());
  await host.waitForFunction(() => window.snapshot.members.some(m=>m.name === 'Sam' && !m.online));
  await wire(guest, guestCredentials);
  assert.equal((await state(guest)).you, guestId);
  assert.equal((await state(guest)).members.find(m=>m.id === guestId).vote, '3');
  await host.evaluate(() => window.testConnection.stop());
  await guest.waitForFunction(() => window.snapshot.members.find(m=>m.id === window.snapshot.you).isHost);
  await wire(host, credentials);
  const view = await state(host);
  assert.equal(view.members.find(m=>m.id === view.you).isHost, false);
});

test('invalid inputs, forged tokens, second join, and idle connections cannot mutate rooms', async t => {
  const response = await fetch(`${origin}/api/rooms`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ playerName: ' ', deck: 'fibonacci' }) });
  assert.equal(response.status, 400);
  const credentials = await createRoom();
  const host = await pageFor(t), other = await pageFor(t);
  await wire(host, credentials);
  await assert.rejects(hub(host, 'Join', { roomId: credentials.roomId, name:'Duplicate' }), /Leave your current session/);
  await assert.rejects(hub(host, 'SetTopic', 'x'.repeat(181)), /at most 180/);
  await assert.rejects(hub(host, 'SetTimer', -1), /valid timer/);
  await assert.rejects(hub(host, 'Reveal'), /at least one card/);
  await assert.rejects(wire(other, { roomId: credentials.roomId, token: 'forged' }), /place in this session has expired/);
  await assert.rejects(hub(other, 'Vote', '5'), /Join a session first/);
  assert.equal((await state(host)).members.length, 1);
  const health = await fetch(`${origin}/health`);
  assert.deepEqual(await health.json(), { status:'healthy' });
  const headers = await fetch(origin);
  assert.ok(headers.headers.get('content-security-policy').includes("script-src 'self'"));
});

test('topic text stays text, timer is shared, and round CSV downloads', async t => {
  const credentials = await createRoom('Alex', { name:'<img src=x onerror=alert(1)>' });
  const host = await pageFor(t), guest = await pageFor(t);
  await openRoom(host, credentials);
  await joinGuest(guest, credentials.roomId, '<script>unsafe</script>');
  assert.equal(await host.locator('.room-title-row h1 img').count(), 0);
  await host.getByRole('button', { name:'Set round timer' }).click();
  await host.getByRole('button', { name:'1 min', exact:true }).click();
  await guest.waitForFunction(() => /^0:\d\d|1:00$/.test(document.querySelector('#timer-label').textContent));
  await host.getByRole('button', { name:'Edit round topic' }).click();
  await host.getByRole('textbox', { name:'Round topic', exact:false }).fill('=A1+1');
  await host.getByRole('button', { name:'Save topic' }).click();
  await host.getByRole('button', { name:'Estimate 3', exact:true }).click();
  await guest.getByRole('button', { name:'Estimate 5', exact:true }).click();
  await host.getByRole('button', { name:'Reveal cards' }).click();
  await host.getByRole('button', { name:'Export round history as CSV' }).waitFor();
  const downloaded = host.waitForEvent('download');
  await host.getByRole('button', { name:'Export round history as CSV' }).click();
  const download = await downloaded;
  const csv = await readFile(await download.path(), 'utf8');
  assert.ok(csv.includes("'=A1+1"), 'CSV must escape formula-leading values');
  assert.ok(csv.includes('"4"'), 'CSV contains numeric average');
  await host.getByRole('button', { name:'Vote again', exact:true }).click();
  await host.locator('#accept-confirm').click();
  await host.getByText('Your card stays hidden from the other players.', { exact:true }).waitFor();
});

test('unknown-room errors are actionable and both landing tabs fit a narrow viewport', async t => {
  const page = await pageFor(t, { width: 360, height: 800 });
  await page.goto(`${origin}/room/00000000`);
  await page.getByLabel('Your name', { exact:false }).fill('Alex');
  await page.getByRole('button', { name:'Join session', exact:true }).click();
  await page.locator('#start-error').filter({ hasText:'Session not found' }).waitFor();
  await page.getByRole('tab', { name:'Start a Session' }).click();
  await page.screenshot({ path:new URL('landing-mobile.png', screenshots).pathname, fullPage:true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
});

test('no uncaught browser JavaScript errors', () => {
  assert.deepEqual(browserErrors, []);
});
