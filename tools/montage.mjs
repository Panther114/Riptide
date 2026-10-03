// Contact sheet of screenshots: node tools/montage.mjs <dir> <prefix> <out.png>
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [dir, prefix, outFile] = process.argv.slice(2);
const files = readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.png')).sort();
const cell = (f) => `<div style="position:relative"><img src="${pathToFileURL(resolve(dir, f)).href}" style="width:533px"><span style="position:absolute;left:4px;top:2px;color:#ff0;font:14px monospace">${f}</span></div>`;
const html = `<body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(3,533px);gap:2px">${files.map(cell).join('')}</body>`;
const page = resolve(dir, '_montage.html');
writeFileSync(page, html);
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--allow-file-access-from-files'] });
const p = await b.newPage({ viewport: { width: 1603, height: 900 } });
await p.goto(pathToFileURL(page).href);
await p.waitForTimeout(500);
await p.screenshot({ path: outFile, fullPage: true });
await b.close();
