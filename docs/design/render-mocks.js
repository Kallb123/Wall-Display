// Renders every mock on the Wall Display canvas to an image, one file per mock id.
//
//   node docs/design/render-mocks.js <source dir> <out dir> <deps node_modules>
//
// The exported canvas loads React and Babel from unpkg and the fonts from Google Fonts.
// This serves them from <deps node_modules> instead, so it works offline. See README.md.
const { chromium } = require('playwright');
const fs = require('fs'), http = require('http'), path = require('path');

const [src, out, nm] = process.argv.slice(2).map(p => p && path.resolve(p));
if (!nm) { console.error('usage: node render-mocks.js <source dir> <out dir> <deps node_modules>'); process.exit(1); }

const cdn = {
  'https://unpkg.com/react@18.3.1/umd/react.production.min.js': 'react/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js': 'react-dom/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone@7.29.0/babel.min.js': '@babel/standalone/babel.min.js',
};
const fonts = [['Caprasimo', 400, 'caprasimo'], ['Figtree', 400, 'figtree'], ['Figtree', 600, 'figtree'], ['Figtree', 700, 'figtree']];
const fontCss = fonts.map(([family, w, pkg]) =>
  `@font-face{font-family:'${family}';font-weight:${w};font-style:normal;font-display:block;` +
  `src:url(https://fonts.local/${pkg}/files/${pkg}-latin-${w}-normal.woff2) format('woff2')}`).join('\n');
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };

// Mocks larger than this on their long side are scaled down (2560×1440 → 1280×720).
const MAX = 1280;

(async () => {
  const server = http.createServer((req, res) => {
    const file = path.join(src, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(src) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }).listen(0);
  const base = `http://localhost:${server.address().port}`;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 2800, height: 1600 }, deviceScaleFactor: 1 });
  page.on('console', m => m.type() === 'error' && console.warn('page:', m.text().slice(0, 300)));
  await page.route('**/*', route => {
    const url = route.request().url();
    if (cdn[url]) return route.fulfill({ path: path.join(nm, cdn[url]), contentType: 'application/javascript' });
    if (url.startsWith('https://fonts.googleapis.com/')) return route.fulfill({ body: fontCss, contentType: 'text/css' });
    if (url.startsWith('https://fonts.local/')) return route.fulfill({ path: path.join(nm, '@fontsource', url.slice('https://fonts.local/'.length)), contentType: 'font/woff2' });
    if (url.startsWith(base)) return route.continue();
    console.warn('blocked:', url);
    return route.abort();
  });

  await page.goto(`${base}/Wall%20Display.dc.html`, { waitUntil: 'networkidle', timeout: 90000 });
  await page.evaluate(async () => {
    await Promise.all([document.fonts.load('400 40px Caprasimo'), document.fonts.load('700 40px Figtree')]);
    await document.fonts.ready;
  });
  await page.waitForTimeout(3000);

  // Each mock is a .dv-opt with a .dv-card holding the artboard, shown scaled down.
  // Re-scale it to MAX on its long side (or 1:1 if smaller) and drop the card's frame.
  const mocks = await page.evaluate(MAX => [...document.querySelectorAll('.dv-opt')].map(opt => {
    const card = opt.querySelector('.dv-card');
    const board = card && card.firstElementChild;
    if (!board) return null;
    const w = parseFloat(board.style.width), h = parseFloat(board.style.height);
    if (w && h) {
      const s = Math.min(1, MAX / Math.max(w, h));
      board.style.transform = `scale(${s})`;
      Object.assign(card.style, { width: `${w * s}px`, height: `${h * s}px`, border: '0', borderRadius: '0' });
    }
    return { id: opt.id, photo: !!card.querySelector('img'), label: opt.querySelector('.dv-olabel').textContent.trim() };
  }).filter(Boolean), MAX);
  await page.waitForTimeout(1500);

  fs.mkdirSync(out, { recursive: true });
  for (const m of mocks) {
    // Mocks with a photo in them are JPEG; the rest are flat colour and stay PNG.
    const file = path.join(out, `${m.id}.${m.photo ? 'jpg' : 'png'}`);
    await page.locator(`[id="${m.id}"] .dv-card`).screenshot(m.photo ? { path: file, type: 'jpeg', quality: 88 } : { path: file });
    console.log(path.relative(process.cwd(), file), '-', m.label);
  }
  await browser.close();
  server.close();
})();
