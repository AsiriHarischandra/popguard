// Renders docs/store/icon.svg to the extension icons and the 128px store icon.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = fs.readFileSync(path.join(ROOT, 'docs/store/icon.svg'), 'utf8');
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
async function render(size, art, out) {
  await page.setViewportSize({ width: size, height: size });
  const pad = (size - art) / 2;
  await page.setContent(`<html><body style="margin:0;background:transparent">
    <div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center">
      <div style="width:${art}px;height:${art}px">${svg.replace('<svg ', `<svg width="${art}" height="${art}" `)}</div></div></body></html>`);
  await page.screenshot({ path: out, omitBackground: true });
}
for (const s of [16, 32, 48, 128]) await render(s, s, path.join(ROOT, `extension/icons/icon${s}.png`));
// Chrome Web Store guideline: 96x96 artwork inside a 128x128 canvas
await render(128, 96, path.join(ROOT, 'docs/store/images/icon-128.png'));
await browser.close();
console.log('icons rendered');
