// Desktop screenshots and checks for map/index.html. Run inside the web container:
//   docker cp docs/mockups/comparison/map/. fiber-web-1:/tmp/cmp/map/ && docker compose exec web node /tmp/cmp/map/shots/shoot.cjs
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
  // map label collisions: chips, names, site codes, region labels, overlay controls (only items inside the visible map)
  const box = document.getElementById('mapbox').getBoundingClientRect(), min = document.getElementById('work').classList.contains('min');
  const items = [...document.querySelectorAll('.mchip:not(.off),.mname,.code,.rlab,.mctl,.mleg')].map(e => [e, e.getBoundingClientRect()])
    .filter(([e, r]) => r.width && (!min || (r.bottom > box.top && r.top < box.bottom)));
  for (let i = 0; i < items.length; i++) {
    const [a, r] = items[i];
    if (!min && (r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1)) out.overlap.push('outside ' + a.className + ' ' + a.textContent.trim().slice(0, 16));
    for (let j = i + 1; j < items.length; j++) {
      const [b, s] = items[j];
      if (a.contains(b) || b.contains(a)) continue;
      if (r.left < s.right - 1 && s.left < r.right - 1 && r.top < s.bottom - 1 && s.top < r.bottom - 1)
        out.overlap.push(a.className.split(' ')[0] + ' "' + a.textContent.trim().slice(0, 14) + '" x ' + b.className.split(' ')[0] + ' "' + b.textContent.trim().slice(0, 14) + '"');
    }
  }
  const rect = s => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().height) : 0; };
  out.heights = { map: rect('.g-map'), rail: rect('.g-rail'), insp: rect('.insp') };
  // inspector content cut? (scrollHeight beyond its box)
  const ins = document.querySelector('.insp'); out.inspCut = ins.scrollHeight - ins.clientHeight;
  out.clipped = [...new Set(out.clipped)]; out.small = [...new Set(out.small)];
  return out;
});
const bar = p => p.evaluate(() => {
  const f = document.getElementById('cfoot'); if (!f) return 'no bar';
  const r = f.getBoundingClientRect(), c = document.querySelector('.ccard').getBoundingClientRect();
  return { barBottom: Math.round(r.bottom), vh: innerHeight, cardBottom: Math.round(c.bottom), pinned: Math.abs(r.bottom - innerHeight) < 1 && c.bottom > innerHeight + 1 };
});
// Full-page capture keeps the sticky bar at the original viewport offset, so unstick it for full-page shots only.
const full = async (p, path) => { await p.evaluate(() => { const f = document.getElementById('cfoot'); if (f) f.style.position = 'static'; });
  await p.screenshot({ path, fullPage: true }); await p.evaluate(() => { const f = document.getElementById('cfoot'); if (f) f.style.position = ''; }); };
const state = async (p, s) => { await p.click(`.dev button[data-state="${s}"]`); await p.waitForTimeout(400); };
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('file://' + D + 'index.html'); await p.waitForTimeout(1200);
  const names = { 1: 'nothing', 2: 'span', 3: 'route', 4: 'short', 5: 'empty', 6: 'pinned' };
  for (const s of [1, 2, 3, 4, 5, 6]) {
    await state(p, s); await p.waitForTimeout(300);
    console.log(1440, names[s], JSON.stringify(await check(p)));
    if (s === 6) { console.log('pinned state bar', JSON.stringify(await bar(p))); await p.screenshot({ path: D + 'shots/1440-6-pinned-view.png' }); }
    await full(p, D + `shots/1440-${s}-${names[s]}.png`);
  }
  // state 2 viewport shots: top, and scrolled into the grid
  await state(p, 2); await p.screenshot({ path: D + 'shots/1440-2-span-view-top.png' });
  await p.click('[data-act=cores]'); await p.waitForTimeout(900);
  console.log('go to cores -> focus', await p.evaluate(() => document.activeElement.getAttribute('aria-label')), JSON.stringify(await bar(p)));
  await p.screenshot({ path: D + 'shots/1440-2-span-view-cores.png' });
  // sticky: pinned while grid in view, unpinned after the card ends
  await p.evaluate(() => { const g = document.querySelector('.tube').getBoundingClientRect(); scrollTo(0, scrollY + g.top - 500); }); await p.waitForTimeout(100);
  console.log('sticky mid-grid', JSON.stringify(await bar(p)));
  await p.evaluate(() => scrollTo(0, document.body.scrollHeight)); await p.waitForTimeout(100);
  console.log('sticky at page end', JSON.stringify(await bar(p)));
  // selection, cap, chips, button, after-this
  await p.evaluate(() => scrollTo(0, 0));
  await p.click('.core[data-n="4"]'); await p.click('.core[data-n="5"]');
  console.log('select 2 ->', await p.evaluate(() => [document.getElementById('c-now').textContent, document.getElementById('c-chips').textContent, document.getElementById('reserve').textContent, document.getElementById('c-note').textContent, document.getElementById('lg-ch').textContent].join(' | ')));
  await p.click('.core[data-n="1"]', { force: true }); console.log('taken click ->', await p.textContent('#c-now'));
  await p.evaluate(() => document.querySelectorAll('#cores .s-av').forEach(b => b.click()));
  console.log('cap ->', await p.evaluate(() => document.querySelectorAll('#cores .s-av[aria-pressed=true]').length + ' chosen of ' + document.querySelectorAll('#cores .s-av').length + ' | ' + document.getElementById('c-more').textContent + ' | ' + document.getElementById('c-note').textContent));
  await p.click('#clear'); await p.click('#reserve').catch(() => {});
  await p.click('.core[data-n="7"]'); await p.click('#reserve'); console.log('no customer ->', await p.textContent('#c-note'), await p.getAttribute('#cust', 'aria-invalid'));
  // keyboard roving
  await p.focus('.core[data-n="7"]'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowDown');
  console.log('roving ->', await p.evaluate(() => document.activeElement.getAttribute('aria-label') + ' tabindex0=' + [...document.querySelectorAll('#cores .core')].filter(b => b.tabIndex === 0).map(b => b.dataset.n)));
  await p.keyboard.press('Home'); console.log('home ->', await p.evaluate(() => document.activeElement.getAttribute('aria-label')));
  // held filter + expander
  await p.click('.chip[data-f="iu"]'); console.log('filter iu rows ->', await p.evaluate(() => [...document.querySelectorAll('#cores tbody tr')].filter(r => !r.hidden).length));
  await p.click('.exp'); console.log('expand ->', await p.evaluate(() => [...document.querySelectorAll('#cores tbody tr')].filter(r => !r.hidden).length));
  await p.click('.chip[data-f="all"]');
  // different span replaces the section and resets chosen
  await p.click('#slist button[data-i="1"]'); await p.waitForTimeout(200);
  console.log('other span ->', await p.textContent('#cores-h'), await p.textContent('#c-now'), await p.evaluate(() => location.hash));
  // collapse map
  await p.click('.dev button[data-state="2"]'); await p.waitForTimeout(300);
  await p.click('#mtog'); await p.waitForTimeout(400);
  console.log('collapsed', JSON.stringify(await check(p)), await p.evaluate(() => Math.round(document.getElementById('mapbox').getBoundingClientRect().height)));
  await full(p, D + 'shots/1440-collapsed.png');
  await p.screenshot({ path: D + 'shots/1440-collapsed-view.png' });
  await p.click('.mchip[data-i="3"]'); await p.waitForTimeout(400);
  console.log('collapsed click chip ->', await p.textContent('#cores-h'), 'min=', await p.evaluate(() => document.getElementById('work').classList.contains('min')));
  await p.click('#fit'); await p.waitForTimeout(300);
  console.log('collapsed fit ->', await p.evaluate(() => { const c = document.querySelector('.mchip.on').getBoundingClientRect(), m = document.getElementById('mapbox').getBoundingClientRect(); return c.top > m.top && c.bottom < m.bottom ? 'selected chip visible' : 'NOT visible'; }));
  await p.screenshot({ path: D + 'shots/1440-collapsed-other.png' });
  await p.click('#mtog');
  // hash restore
  await p.goto('file://' + D + 'index.html#span=HHJJ-JJKK'); await p.reload(); await p.waitForTimeout(800);
  console.log('hash span ->', await p.textContent('#cores-h'));
  await p.goto('file://' + D + 'index.html#route=AABB-DDEE'); await p.reload(); await p.waitForTimeout(800);
  console.log('hash route ->', await p.textContent('#dsub'), await p.isHidden('#cores'));
  await p.goto('file://' + D + 'index.html#state=3'); await p.reload(); await p.waitForTimeout(800);
  console.log('hash state=3 ->', await p.evaluate(() => location.hash), await p.isVisible('#drawer'));
  // route inspector list: 7-span option shows 3 + more
  await p.click('.opt[data-k="2"]'); console.log('7-span list ->', await p.evaluate(() => document.querySelectorAll('.rsp li').length + ' rows, ' + (document.querySelector('[data-act=rmore]') || {}).textContent));
  await full(p, D + 'shots/1440-3-route-opt3.png');
  if (await p.$('[data-act=rmore]')) { await p.click('[data-act=rmore]'); console.log('more ->', await p.evaluate(() => document.querySelectorAll('.rsp li').length)); }
  await p.evaluate(() => { document.querySelector('.rsp li:first-child button').click(); document.querySelector('[data-act=back]').click(); });
  console.log('7-span after picking row 1 ->', await p.evaluate(() => document.querySelectorAll('.rsp li').length + ' rows, ' + (document.querySelector('[data-act=rmore]') || {}).textContent));
  await p.screenshot({ path: D + 'shots/1440-3-route-opt3-collapsed-list.png' });
  await p.click('[data-act=rmore]'); console.log('more ->', await p.evaluate(() => document.querySelectorAll('.rsp li').length));
  await p.click('.dev button[data-state="3"]'); await p.click('#go'); console.log('route reserve ->', await p.textContent('#msg'));
  // role switch
  await p.click('.dev [data-role="planner"]');
  console.log('planner ->', await p.evaluate(() => [...document.querySelectorAll('.nav a')].filter(a => a.offsetParent).map(a => a.textContent.trim()).join(' / ') + ' | ' + document.querySelector('.abtn').textContent.trim()));
  await state(p, 2); await p.screenshot({ path: D + 'shots/1440-planner.png' });
  await p.click('#abtn'); console.log('planner menu ->', await p.textContent('#a-menu')); await p.keyboard.press('Escape');
  await p.click('.dev [data-role="admin"]');
  console.log('admin ->', await p.evaluate(() => [...document.querySelectorAll('.nav a')].filter(a => a.offsetParent).map(a => a.textContent.trim()).join(' / ') + ' | ' + document.querySelector('.abtn').textContent.trim()));
  // older interaction checks
  await state(p, 1);
  await p.click('.mchip[data-i="1"]'); console.log('click chip ->', await p.textContent('#ibody h3'));
  await p.keyboard.press('Escape'); console.log('esc ->', (await p.textContent('#ibody')).slice(0, 40), await p.isHidden('#cores'));
  await p.selectOption('#freg', 'Central'); await p.waitForTimeout(300); console.log('filter ->', await p.textContent('#fcount'));
  await p.selectOption('#freg', 'all');
  await state(p, 2); await p.click('[data-act=plan]'); console.log('plan from here ->', await p.inputValue('#from'), await p.isVisible('#p-route'));
  await p.close();
  for (const w of [1280, 1920]) {
    const q = await b.newPage({ viewport: { width: w, height: w === 1920 ? 1080 : 800 } });
    q.on('pageerror', e => console.log('ERR', e.message));
    for (const s of [2, 3]) {
      await q.goto('file://' + D + 'index.html#state=' + s); await q.reload(); await q.waitForTimeout(1000);
      console.log(w, names[s], JSON.stringify(await check(q)));
      await full(q, D + `shots/${w}-${s}-${names[s]}.png`);
    }
    console.log(w, 'topbar', JSON.stringify(await q.evaluate(() => {
      const r = e => { const b = document.querySelector(e).getBoundingClientRect(); return [Math.round(b.left), Math.round(b.right)]; };
      const dv = document.querySelector('.dev'); return { brand: r('.brand'), nav: r('.nav'), search: r('.search'), acct: r('.acct'), devOverflow: dv.scrollWidth - dv.clientWidth };
    })));
    await q.goto('file://' + D + 'index.html#state=6'); await q.reload(); await q.waitForTimeout(1200);
    console.log(w, 'pinned', JSON.stringify(await bar(q)));
    await q.screenshot({ path: D + `shots/${w}-6-pinned-view.png` });
    await q.close();
  }
  await b.close();
})();
