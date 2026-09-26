// Usage: node tools/capture.mjs [samples] [w] [h] view1,view2,...
import { chromium } from '/tmp/pw/node_modules/playwright/index.mjs';
import path from 'path';
const samples = +(process.argv[2] || 8), W = +(process.argv[3] || 1600), H = +(process.argv[4] || 1000);
const views = (process.argv[5] || 'hero').split(',');
const prefix = process.argv[6] || '';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const logs = [];
p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text()); });
p.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
const t0 = Date.now();
await p.goto('file://' + path.resolve('dist/index.html'));
await p.waitForFunction(() => window.__f1, null, { timeout: 600000 });
console.log('ready in', (Date.now() - t0) / 1000, 's');
await p.evaluate((n) => window.__f1.setMax(n), samples);
for (const v of views) {
  const t1 = Date.now();
  await p.evaluate((v) => window.__f1.setView(v), v);
  await p.waitForTimeout(300);
  await p.waitForFunction(() => window.__f1.samples() >= window.__f1.max(), null, { timeout: 900000 });
  const data = await p.evaluate(() => document.querySelector('canvas').toDataURL('image/png'));
  (await import('fs')).writeFileSync(`shots/${prefix}${v}.png`, Buffer.from(data.split(',')[1], 'base64'));
  console.log(v, 'in', (Date.now() - t1) / 1000, 's');
}
console.log(logs.slice(0, 20).join('\n'));
await b.close();
