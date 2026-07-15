async page => {
  const tray = page.locator('.betting-tray');
  await tray.waitFor({ state: 'visible', timeout: 30000 });
  return await tray.boundingBox();
}
