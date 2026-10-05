// Headless screenshot driver (runs Chrome in the background; never touches the desktop).
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
const BROWSERS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const executablePath = BROWSERS.find((p) => existsSync(p));
const url = process.argv[2] ?? 'http://localhost:5173/';
const script = process.argv[3] ?? '';
const out = process.argv[4] ?? 'shots/shot.png';
const browser = await chromium.launch({ executablePath, headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForTimeout(1500);
if (script) {
  const steps = (await import(pathToFileURL(script).href)).default;
  await steps(page, out);
} else {
  await page.screenshot({ path: out });
}
console.log(logs.slice(-30).join('\n'));
await browser.close();
