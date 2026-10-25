// Desktop screenshots and checks for v4/index.html. Run inside the web container.
const { chromium } = require('/app/node_modules/playwright');
const D = '/tmp/cmp/v4/';
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  for (const w of [1280, 1440, 1920]) {
    const p = await b.newPage({ viewport: { width: w, height: 900 } });
    p.on('pageerror', e => console.log('ERR', e.message));
    await p.goto('file://' + D + 'index.html'); await p.waitForTimeout(1200);
    const check = () => p.evaluate(() => {
      const out = { hscroll: document.documentElement.scrollWidth - innerWidth, clipped: [], small: [], wrapped: [] };
      for (const el of document.querySelectorAll('body *')) {
        if (!el.offsetParent || el.closest('.vh')) continue;
        const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
        const cs = getComputedStyle(el);
        if (own && parseFloat(cs.fontSize) < 11) out.small.push(el.className + ':' + cs.fontSize);
        if (own && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) out.clipped.push(el.className + ' "' + el.textContent.trim().slice(0, 24) + '"');
        if (el.matches('.core .w > span, .core .w') && own) { const c = el.closest('.core').getBoundingClientRect(), r = el.getBoundingClientRect(); if (r.right > c.right - 2) out.clipped.push('cell-word "' + el.textContent + '" ' + Math.round(r.right - c.right)); }
      }
      for (const td of document.querySelectorAll('tr:not([hidden]) td')) if (td.getBoundingClientRect().height > 50) out.wrapped.push(td.textContent.trim().slice(0, 30));
      out.clipped = [...new Set(out.clipped)].slice(0, 12); out.small = [...new Set(out.small)];
      out.cell = Math.round(document.querySelector('.core').getBoundingClientRect().width);
      const R=e=>document.querySelector(e).getBoundingClientRect();
      out.edges = {main:Math.round(R('.g-main').bottom), rail:Math.round(R('.g-rail').bottom), mainTop:Math.round(R('.g-main').top), railTop:Math.round(R('.g-rail').top), heldTop:Math.round(R('.g-held').top)};
      out.gaps = [...document.querySelectorAll('.g-main>.card,.g-rail>.card')].map(c=>Math.round(c.getBoundingClientRect().top));
      out.cfoot = Math.round(R('.cfoot').height);
      out.inputs = [R('#cust').width, R('#plan').width].map(Math.round);
      return out;
    });
    console.log(w, JSON.stringify(await check()));
    await p.screenshot({ path: D + 'shots/' + w + '-full.png', fullPage: true });
    await p.screenshot({ path: D + 'shots/' + w + '-fold.png' });
    if (w === 1440) {
      await p.click('.core[data-n="9"]'); await p.click('.core[data-n="20"]');
      console.log('sel3', await p.textContent('#c-now'), '|', await p.textContent('#c-more'), '|', await p.textContent('#reserve'), '|', await p.textContent('#c-note'), '| legend', await p.textContent('#lg-ch'));
      await p.focus('.core[data-n="9"]'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowLeft');
      console.log('keys', await p.evaluate(() => document.activeElement.getAttribute('aria-label') + ' disabled=' + document.activeElement.getAttribute('aria-disabled') + ' tab0=' + document.querySelectorAll('.core[tabindex="0"]').length));
      await p.keyboard.press('Space');
      console.log('space on taken', await p.textContent('#c-now'));
      await p.screenshot({ path: D + 'shots/1440-select.png' });
      await p.click('#reserve'); console.log('nocust', await p.textContent('#c-note'));
      await p.click('#clear');
      console.log('clear', await p.textContent('#reserve'), await p.evaluate(() => document.getElementById('reserve').disabled), '|', await p.textContent('#c-note'));
      await p.screenshot({ path: D + 'shots/1440-none.png' });
      for (const n of [4,5,6,8,9,10,11,12,19,20,21,22,23,24,25,26,27,28,29,31,32,33,34]) await p.click('.core[data-n="' + n + '"]');
      console.log('cap', await p.textContent('#c-now'), '|', await p.textContent('#c-more'));
      await p.click('#clear');
      await p.click('.chip[data-f="iu"]'); await p.click('.exp');
      console.log('filter iu rows', await p.evaluate(() => [...document.querySelectorAll('tbody tr')].filter(r => !r.hidden).length));
      const h = await p.$('.g-held'); await h.screenshot({ path: D + 'shots/1440-held-inuse.png' });
      await p.click('.chip[data-f="co"]');
      console.log('filter co rows', await p.evaluate(() => [...document.querySelectorAll('tbody tr')].filter(r => !r.hidden).map(r => r.cells[0].textContent)));
    }
    await p.close();
  }
  await b.close();
})();
