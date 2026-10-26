// Desktop screenshots and checks for map/index.html. Run inside the web container.
const { chromium } = require('/app/node_modules/playwright');
const D = '/tmp/cmp/map/';
const check = p => p.evaluate(() => {
  const out = { hscroll: document.documentElement.scrollWidth - innerWidth, clipped: [], small: [], overlap: [] };
  for (const el of document.querySelectorAll('body *')) {
    if (!el.getClientRects().length || el.closest('.vh,[hidden]')) continue;
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    const cs = getComputedStyle(el);
    if (own && parseFloat(cs.fontSize) < 11) out.small.push(el.className + ':' + cs.fontSize);
    if (own && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && cs.overflow !== 'visible') out.clipped.push(el.className + ' "' + el.textContent.trim().slice(0, 24) + '"');
  }
  // map label collisions: chips, names, site codes, region labels, overlay controls
  const box = document.getElementById('mapbox').getBoundingClientRect();
  const items = [...document.querySelectorAll('.mchip:not(.off),.mname,.code,.rlab,.mctl,.mleg')].map(e => [e, e.getBoundingClientRect()]);
  for (let i = 0; i < items.length; i++) {
    const [a, r] = items[i];
    if (r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1) out.overlap.push('outside ' + a.className + ' ' + a.textContent.trim().slice(0, 16));
    for (let j = i + 1; j < items.length; j++) {
      const [b, s] = items[j];
      if (a.contains(b) || b.contains(a)) continue;
      if (r.left < s.right - 1 && s.left < r.right - 1 && r.top < s.bottom - 1 && s.top < r.bottom - 1)
        out.overlap.push(a.className.split(' ')[0] + ' "' + a.textContent.trim().slice(0, 14) + '" x ' + b.className.split(' ')[0] + ' "' + b.textContent.trim().slice(0, 14) + '"');
    }
  }
  const g = id => document.getElementById(id);
  const rect = s => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().height) : 0; };
  out.heights = { map: rect('.g-map'), rail: rect('.g-rail') };
  out.go = g('drawer').hidden ? 'no drawer' : g('go').textContent + (g('go').disabled ? ' (disabled)' : '');
  out.clipped = [...new Set(out.clipped)]; out.small = [...new Set(out.small)];
  return out;
});
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('file://' + D + 'index.html'); await p.waitForTimeout(1200);
  const names = { 1: 'nothing', 2: 'span', 3: 'route', 4: 'short', 5: 'empty' };
  for (const s of [1, 2, 3, 4, 5]) {
    await p.click(`.dev button[data-state="${s}"]`); await p.waitForTimeout(350);
    console.log(1440, names[s], JSON.stringify(await check(p)));
    await p.screenshot({ path: D + `shots/1440-${s}-${names[s]}.png`, fullPage: true });
  }
  // interactions
  await p.click('.dev button[data-state="1"]');
  await p.click('.mchip[data-i="1"]'); console.log('click chip ->', await p.textContent('#ibody h3'));
  await p.keyboard.press('Escape'); console.log('esc ->', (await p.textContent('#ibody')).slice(0, 40));
  await p.focus('.mchip[data-i="0"]'); await p.keyboard.press('ArrowRight');
  console.log('arrow ->', await p.evaluate(() => document.activeElement.getAttribute('aria-label')));
  await p.selectOption('#freg', 'Central'); await p.waitForTimeout(300); console.log('filter ->', await p.textContent('#fcount'));
  await p.screenshot({ path: D + 'shots/1440-filter.png' });
  await p.selectOption('#freg', 'all');
  await p.click('.dev button[data-state="3"]'); await p.click('.lk[data-i="0"]');
  console.log('ribbon click ->', await p.textContent('#ibody h3'));
  await p.keyboard.press('ArrowRight'); console.log('ribbon arrow ->', await p.textContent('#ibody h3'));
  await p.selectOption('#to', 'AABB'); console.log('same ->', await p.textContent('#perr'));
  await p.screenshot({ path: D + 'shots/1440-same.png' });
  await p.selectOption('#to', 'TTEE'); console.log('ttee ->', await p.textContent('#ibody'));
  await p.click('.dev button[data-state="2"]');
  await p.click('[data-act=plan]'); console.log('plan from here ->', await p.inputValue('#from'), await p.isVisible('#p-route'));
  await p.click('.dev button[data-state="1"]'); await p.click('#q'); await p.waitForTimeout(150);
  await p.screenshot({ path: D + 'shots/1440-search.png' });
  await p.click('.dev button[data-state="2"]'); await p.click('#lbtn'); await p.focus('#tab-cores'); await p.keyboard.press('ArrowRight');
  console.log('tab ->', await p.evaluate(() => document.activeElement.textContent + ' | tip visible: ' + getComputedStyle(document.activeElement.querySelector('.tip')).display));
  await p.screenshot({ path: D + 'shots/1440-layers-tab.png' });
  await p.click('#lbtn');
  await p.click('#zin'); await p.click('#fit'); await p.waitForTimeout(300);
  await p.screenshot({ path: D + 'shots/1440-fit.png' });
  // account menu: keyboard open, Esc closes and returns focus
  await p.focus('#abtn'); await p.keyboard.press('Enter'); await p.waitForTimeout(100);
  console.log('acct open ->', await p.evaluate(() => document.activeElement.textContent + ' expanded=' + document.getElementById('abtn').getAttribute('aria-expanded')));
  await p.screenshot({ path: D + 'shots/1440-account.png' });
  await p.keyboard.press('Escape');
  console.log('acct esc ->', await p.evaluate(() => document.activeElement.id + ' hidden=' + document.getElementById('amenu').hidden));
  await p.close();
  for (const w of [1280, 1920]) {
    const q = await b.newPage({ viewport: { width: w, height: w === 1920 ? 1080 : 800 } });
    q.on('pageerror', e => console.log('ERR', e.message));
    await q.goto('file://' + D + 'index.html#state=3'); await q.waitForTimeout(1200);
    console.log(w, 'route', JSON.stringify(await check(q)));
    console.log(w, 'topbar', JSON.stringify(await q.evaluate(() => {
      const t = document.querySelector('.top'), r = e => { const b = document.querySelector(e).getBoundingClientRect(); return [Math.round(b.left), Math.round(b.right), Math.round(b.top), Math.round(b.bottom)]; };
      const i = document.getElementById('q'), c = document.createElement('canvas').getContext('2d'); c.font = getComputedStyle(i).font;
      return { h: t.offsetHeight, brand: r('.brand'), nav: r('.nav'), search: r('.search'), acct: r('.acct'), phFits: c.measureText(i.placeholder).width <= i.clientWidth - 48 };
    })));
    await q.screenshot({ path: D + `shots/${w}-3-route.png`, fullPage: true });
    await q.close();
  }
  await b.close();
})();
