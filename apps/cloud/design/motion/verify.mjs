import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from '@playwright/test';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.resolve(root, '../../public');
const proof = path.join(root, 'proof');
await mkdir(proof, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/fixture') {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<html><body style="margin:0;background:#08090b"><iframe title="Motion" src="/motion/${url.searchParams.get('mobile') ? 'mobile' : 'index'}.html?embed=1" style="border:0;width:100vw;height:100vh"></iframe></body></html>`);
    return;
  }
  const file = path.resolve(publicRoot, '.' + url.pathname);
  if (!file.startsWith(publicRoot + path.sep)) { res.writeHead(403).end(); return; }
  try { res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream'); res.end(await readFile(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
try {
  for (const [name, width, height, mobile] of [['desktop', 1440, 420, false], ['desktop-short', 1280, 300, false], ['desktop-embed', 1000, 300, false], ['mobile', 390, 390, true], ['mobile-small', 320, 320, true]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    await page.addInitScript(() => { window.motionMessages = []; addEventListener('message', e => { if (e.data?.source === 'agent-bus-motion') window.motionMessages.push(e.data); }); });
    await page.goto(`${origin}/fixture${mobile ? '?mobile=1' : ''}`);
    await page.waitForFunction(() => window.motionMessages.some(m => m.type === 'ready'));
    const frame = page.frames()[1];
    const send = (action, time) => page.evaluate(({ action, time }) => document.querySelector('iframe').contentWindow.postMessage({ source: 'agent-bus-landing', action, time }, location.origin), { action, time });
    const current = () => frame.evaluate(() => window.__timelines['agent-bus'].time());
    assert.equal(await frame.locator('#root').getAttribute('data-height'), mobile ? '600' : '420');
    assert.deepEqual(await frame.evaluate(() => window.__timelines['agent-bus'].labels), {
      connect: 0, request: 3, claim: 6, review: 10, memory: 14,
    });
    if (!mobile) {
      assert.equal(await frame.locator('h1').first().evaluate(el => getComputedStyle(el).fontSize), '40px');
      assert.equal(await frame.locator('#record-memory').evaluate(el => getComputedStyle(el).fontSize), '22px');
      assert.equal(await frame.locator('.logo-wrap img').evaluateAll(images => images.every(img => parseFloat(getComputedStyle(img).width) >= 72)), true);
    }
    // Discard the initial notification to model a parent listener mounted late.
    await page.evaluate(() => { window.motionMessages = []; });
    await send('hello');
    await page.waitForFunction(() => window.motionMessages.some(m => m.type === 'ready'));
    assert.deepEqual(await page.evaluate(() => window.motionMessages.find(m => m.type === 'ready')), {
      source: 'agent-bus-motion', type: 'ready', time: 0, duration: 18, playing: false,
    });
    assert.equal(await current(), 0);
    assert.equal(await frame.locator('img').evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0)), true);
    await page.screenshot({ path: path.join(proof, `${name}-connect.png`) });
    for (const [time, packet, route] of [[3.8, 'packet', 'request'], [6.5, 'packet', 'claim'], [10.5, 'packet-review', 'claim'], [11.5, 'packet-review', 'verify'], [14.5, 'packet-memory', 'memory'], [16, 'packet-memory', 'return']]) {
      await send('seek', time); await page.waitForTimeout(30);
      const distance = await frame.evaluate(({ packet, route }) => {
        const marker = document.getElementById(packet);
        const line = document.getElementById('path-' + route);
        const point = new DOMPoint(0, 0).matrixTransform(marker.getScreenCTM());
        const length = line.getTotalLength();
        let nearest = Infinity;
        for (let i = 0; i <= 1000; i++) {
          const local = line.getPointAtLength(length * i / 1000);
          const sample = new DOMPoint(local.x, local.y).matrixTransform(line.getScreenCTM());
          nearest = Math.min(nearest, Math.hypot(point.x - sample.x, point.y - sample.y));
        }
        return nearest;
      }, { packet, route });
      assert(distance < 2, `${name}: ${packet} detached from ${route} by ${distance}px at ${time}s`);
      if (time === 3.8) await page.screenshot({ path: path.join(proof, `${name}-message-route.png`) });
    }
    for (const [phase, time, field] of [[0, 1.5, null], [1, 4.8, '#record-request'], [2, 8, '#record-owner'], [3, 12.8, '#record-review'], [4, 17, '#record-memory']]) {
      await send('seek', time);
      await page.waitForTimeout(30);
      assert.equal(await current(), time);
      assert.equal(await frame.locator(`#heading-${phase}`).evaluate(el => getComputedStyle(el).opacity), '1');
      if (field) assert.equal(await frame.locator(field).evaluate(el => getComputedStyle(el).opacity), '1', `${field} must be fully opaque at settled preview ${time}`);
      await page.screenshot({ path: path.join(proof, `${name}-${time}.png`) });
    }
    const final = await page.screenshot();
    await send('seek', 2); await page.waitForTimeout(30);
    await send('seek', 17); await page.waitForTimeout(30);
    assert.deepEqual(await page.screenshot(), final, 'Reverse seek must reproduce exact pixels');
    assert.equal(await frame.locator('#record-memory').evaluate(el => getComputedStyle(el).opacity), '1');
    await page.evaluate(() => { window.motionMessages = []; });
    await frame.evaluate(() => {
      window.postMessage({ source: 'agent-bus-landing', action: 'hello' }, location.origin);
      window.dispatchEvent(new MessageEvent('message', { source: parent, origin: 'https://wrong.example', data: { source: 'agent-bus-landing', action: 'hello' } }));
    });
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(() => window.motionMessages.length), 0, 'Untrusted hello must not emit ready');
    await send('hello');
    await page.waitForFunction(() => window.motionMessages.some(m => m.type === 'ready'));
    assert.deepEqual(await page.evaluate(() => window.motionMessages.find(m => m.type === 'ready')), {
      source: 'agent-bus-motion', type: 'ready', time: 17, duration: 18, playing: false,
    });
    assert.equal(await current(), 17, 'Hello must preserve the reduced-motion end state');
    await send('play'); await page.waitForTimeout(250); await send('pause'); await page.waitForTimeout(30);
    const paused = await current();
    assert(paused > 17 && paused < 18);
    await page.waitForTimeout(150); assert.equal(await current(), paused);
    await send('seek', -3); await page.waitForTimeout(30); assert.equal(await current(), 0);
    await send('seek', 100); await page.waitForTimeout(30); assert.equal(await current(), 18);
    await send('seek', 17.95); await send('play'); await page.waitForTimeout(200); await send('pause'); await page.waitForTimeout(30);
    assert(await current() < 1, 'Playback should loop at 18 seconds');
    await frame.evaluate(() => window.postMessage({ source: 'agent-bus-landing', action: 'seek', time: 9 }, location.origin));
    await page.waitForTimeout(30); assert(await current() < 1, 'Non-parent messages must be rejected');
    await frame.evaluate(() => window.dispatchEvent(new MessageEvent('message', { source: parent, origin: 'https://wrong.example', data: { source: 'agent-bus-landing', action: 'seek', time: 9 } })));
    await page.waitForTimeout(30); assert(await current() < 1, 'Foreign origins must be rejected');
    assert.deepEqual(errors, []);
    results.push({ name, viewport: `${width}x${height}`, passed: true, checks: 'loaded assets, ready, late-parent hello handshake, hello state preservation and source/origin rejection, paused opening, six message-route distances below 2px, seek, exact reverse-seek pixels, final memory, play/pause, bounds, loop, source/origin rejection' });
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 420 } });
  await page.goto(`${origin}/motion/index.html`);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__timelines['agent-bus'].time()), 0);
  assert.equal(await page.evaluate(() => window.__timelines['agent-bus'].paused()), true);
  results.push({ name: 'non-embed', passed: true, checks: 'timeline paused and deterministic without embed=1' });
  await writeFile(path.join(proof, 'verification.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
