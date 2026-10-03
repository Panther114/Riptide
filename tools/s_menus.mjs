export default async function (page, out) {
  const shot = (n) => page.screenshot({ path: out.replace('.png', `_${n}.png`) });
  await page.waitForTimeout(3000);
  await shot('title');
  await page.click('[data-a=setup]');
  await page.waitForTimeout(800);
  await page.click('[data-p="3v3"]');
  await page.waitForTimeout(400);
  await shot('setup');
  await page.click('[data-a=back]');
  await page.waitForTimeout(500);
  await page.click('[data-a=help]');
  await page.waitForTimeout(800);
  await shot('manual');
}
