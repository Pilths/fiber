// Desktop screenshots and checks for route/index.html. Run inside the web container.
const { chromium } = require('/app/node_modules/playwright');
const D = '/tmp/cmp/route/';
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  for (const w of [1280, 1440, 1920]) {
    const p = await b.newPage({ viewport: { width: w, height: 900 } });
    p.on('pageerror', e => console.log('ERR', e.message));
    await p.goto('file://' + D + 'index.html'); await p.waitForTimeout(900);
    const check = () => p.evaluate(() => {
      const out = { hscroll: document.documentElement.scrollWidth - innerWidth, clipped: [], small: [], rows: document.querySelectorAll('.row').length };
      for (const el of document.querySelectorAll('body *')) {
        if (!el.offsetParent || el.closest('.vh')) continue;
        const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
        const cs = getComputedStyle(el);
        if (own && parseFloat(cs.fontSize) < 11) out.small.push(el.className + ':' + cs.fontSize);
        if (own && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) out.clipped.push(el.className + ' "' + el.textContent.trim().slice(0, 24) + '"');
        if (el.closest('.lk') && own) { const pr = el.closest('.lk').getBoundingClientRect(), er = el.getBoundingClientRect(); if (er.left < pr.left - 1 || er.right > pr.right + 1) out.clipped.push('lk-overflow "' + el.textContent.trim() + '"'); }
      }
      out.clipped = [...new Set(out.clipped)].slice(0, 12); out.small = [...new Set(out.small)];
      out.go = document.getElementById('go').textContent + (document.getElementById('go').disabled ? ' (disabled)' : '');
      out.why = document.getElementById('why').textContent;
      return out;
    });
    console.log(w, 'default', JSON.stringify(await check()));
    await p.screenshot({ path: D + 'shots/' + w + '-default.png', fullPage: true });
    await p.click('.opt[data-k="2"]'); await p.waitForTimeout(200);
    console.log(w, 'opt3', JSON.stringify(await check()));
    await p.screenshot({ path: D + 'shots/' + w + '-option3.png', fullPage: true });
    await p.click('.opt[data-k="0"]');
    await p.fill('#need', '4'); await p.waitForTimeout(200);
    console.log(w, 'need4', JSON.stringify(await check()));
    await p.screenshot({ path: D + 'shots/' + w + '-need4.png', fullPage: true });
    if (w === 1440) {
      await p.fill('#need', '2');
      await p.focus('.lk[tabindex="0"]'); await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowLeft');
      console.log('keys', await p.evaluate(() => [document.activeElement.getAttribute('aria-label'), document.querySelector('#tb tr.sel td:nth-child(2)').textContent].join(' | ')));
      await p.screenshot({ path: D + 'shots/1440-focus.png' });
      await p.fill('#cust', '[Customer A] Sdn'); await p.waitForTimeout(100);
      console.log('warn', await p.textContent('#cwarn'), '| list', await p.textContent('#clist'));
      await p.screenshot({ path: D + 'shots/1440-customer.png', clip: { x: 1100, y: 150, width: 340, height: 700 } });
      await p.selectOption('#from', 'KKLL');
      console.log('noroute', await p.textContent('#opts'), '|', await p.textContent('#why'));
      await p.screenshot({ path: D + 'shots/1440-noroute.png' });
      await p.selectOption('#from', 'DDEE');
      console.log('same', await p.textContent('#perr'));
      await p.selectOption('#from', 'AABB'); await p.selectOption('#to', 'TTEE');
      console.log('ttee', await p.textContent('#opts'));
      await p.selectOption('#to', 'DDEE'); await p.check('input[value=free]');
      console.log('free', await p.textContent('#opts'));
    }
    await p.close();
  }
  await b.close();
})();
