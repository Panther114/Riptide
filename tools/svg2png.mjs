import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await b.newPage({ viewport: { width: 1200, height: 1200 } });
await p.goto(pathToFileURL(process.argv[2]).href);
await p.screenshot({ path: process.argv[3] });
await b.close();
