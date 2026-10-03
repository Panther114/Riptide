import { chromium } from 'playwright-core';
for (const args of [['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'], ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']]) {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args });
  const p = await b.newPage();
  await p.goto('http://127.0.0.1:5173/?nomenu');
  const r = await p.evaluate(async () => {
    const c = document.createElement('canvas'); const gl = c.getContext('webgl');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const ren = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '?';
    let n = 0; const t0 = performance.now();
    await new Promise((res) => { const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    return { ren, fps: n / 3 };
  });
  console.log(args[0], JSON.stringify(r));
  await b.close();
}
