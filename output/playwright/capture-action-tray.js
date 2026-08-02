async page => {
  const tray = page.locator('.betting-tray');
  await tray.waitFor({ state: 'visible', timeout: 30000 });
  await page.screenshot({ path: 'output/playwright/label-fix-action-tray-immediate.png' });
  return await page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return [box.x, box.y, box.width, box.height].map((value) => Number(value.toFixed(1)));
    };
    return {
      tray: rect('.betting-tray'),
      seat6: rect('.cinematic-seat-6'),
      seat7: rect('.cinematic-seat-7'),
      viewport: [innerWidth, innerHeight],
    };
  });
}
