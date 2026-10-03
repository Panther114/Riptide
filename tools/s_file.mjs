export default async function (page, out) {
  await page.waitForTimeout(2500);
  await page.screenshot({ path: out });
  await page.click('[data-a=quick]');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: out.replace('.png', '_b.png') });
}
