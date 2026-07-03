import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 200 }, deviceScaleFactor: 2 });
await page.goto('file:///home/mhneri/work/webnext/trexure/homepage/index.html', { waitUntil: 'networkidle' });
// clip just the navbar
const nav = await page.$('.nav');
await nav.screenshot({ path: '/tmp/navbar.png' });
// also grab just the brand-mark to inspect pixels
const bm = await page.$('.brand-mark');
await bm.screenshot({ path: '/tmp/brandmark.png' });
await browser.close();
console.log('done');
