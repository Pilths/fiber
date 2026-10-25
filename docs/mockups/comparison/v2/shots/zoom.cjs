// Close-up of tube 1 at 1280 and a keyboard check onto a taken core.
const { chromium } = require('/app/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  await p.goto('file:///tmp/cmp/v2/index.html'); await p.waitForTimeout(1200);
  await p.focus('.core[data-n="4"]'); await p.keyboard.press('ArrowLeft');
  console.log(await p.evaluate(() => document.activeElement.getAttribute('aria-label') + ' | aria-disabled=' + document.activeElement.getAttribute('aria-disabled')));
  await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('End');
  console.log(await p.evaluate(() => document.activeElement.getAttribute('aria-label')));
  await p.focus('.core[data-n="3"]');
  await (await p.$('.grid')).screenshot({ path: '/tmp/cmp/v2/shots/1280-grid-zoom.png' });
  await b.close();
})();
