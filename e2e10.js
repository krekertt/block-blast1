const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 1100 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  await page.goto('file:///workspace/index.html');
  // Симулируем старый/битый CSS — inline-раскраска из JS должна спасти
  await page.addStyleTag({ content: '.c0,.c1,.c2,.c3,.c4,.c5,.c6{background:transparent !important}' });
  await new Promise(r => setTimeout(r, 300));

  const slotCenter = i => page.evaluate(idx => {
    const s = document.querySelectorAll('.piece-slot:not(.used)')[idx];
    if (!s) return null;
    const r = s.getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2 };
  }, i);

  const bb = await page.evaluate(() => {
    const b = document.getElementById('board').getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  const cellPx = (bb.w - 16) / 8;
  const cc = (r, c) => ({ x: bb.x + 8 + c*cellPx + cellPx/2, y: bb.y + 8 + r*cellPx + cellPx/2 });

  const filledCount = () => page.evaluate(() => document.querySelectorAll('.cell.filled').length);
  const visibleFilled = () => page.evaluate(() => [...document.querySelectorAll('.cell.filled')].filter(el => {
    const bg = getComputedStyle(el).backgroundColor;
    return bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
  }).length);

  let fails = [];

  async function dragTo(slotIdx, r, c) {
    const p = await slotCenter(slotIdx);
    if (!p) throw new Error('no slot ' + slotIdx);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    const t = cc(r, c);
    await page.mouse.move(t.x, t.y, { steps: 10 });
    await page.mouse.up();
    await new Promise(res => setTimeout(res, 150));
  }

  // T1: drag в центр
  let before = await filledCount();
  await dragTo(0, 4, 4);
  let after = await filledCount();
  console.log('T1 drag center:', before, '->', after);
  if (after <= before) fails.push('T1 drag placement');

  // T2: клик-клик
  before = after;
  const p2 = await slotCenter(0);
  await page.mouse.click(p2.x, p2.y);
  await new Promise(res => setTimeout(res, 80));
  const sel = await page.evaluate(() => !!document.querySelector('.piece-slot.selected'));
  const t2 = cc(0, 0);
  await page.mouse.click(t2.x, t2.y);
  await new Promise(res => setTimeout(res, 150));
  after = await filledCount();
  console.log('T2 click-click: selected=', sel, before, '->', after);
  if (!sel || after <= before) fails.push('T2 click-click');

  // T3: drag к правому нижнему углу
  before = after;
  await dragTo(0, 7, 7);
  after = await filledCount();
  console.log('T3 corner drag:', before, '->', after);
  if (after <= before) fails.push('T3 corner drag');

  // T4: цвета на поле видны при убитых классах cN
  const vis = await visibleFilled(), tot = await filledCount();
  console.log('T4 board colors: visible=', vis, '/', tot);
  if (tot === 0 || vis !== tot) fails.push('T4 invisible on board');

  // T5: док окрашен
  const dockVis = await page.evaluate(() => {
    const cs = [...document.querySelectorAll('.piece-slot:not(.used) .piece-cell:not(.empty)')];
    return cs.length >= 1 && cs.every(el => {
      const bg = getComputedStyle(el).backgroundColor;
      const r = el.getBoundingClientRect();
      return bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' && r.width > 5;
    });
  });
  console.log('T5 dock colors:', dockVis);
  if (!dockVis) fails.push('T5 dock invisible');

  // T6: ghost окрашен во время drag
  const p6 = await slotCenter(0);
  await page.mouse.move(p6.x, p6.y); await page.mouse.down();
  const g6 = cc(3, 3);
  await page.mouse.move(g6.x, g6.y, { steps: 5 });
  const ghostColored = await page.evaluate(() => {
    const cs = [...document.querySelectorAll('#ghost .piece-cell:not(.empty)')];
    return cs.length > 0 && cs.every(el => getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)');
  });
  await page.mouse.up();
  console.log('T6 ghost colored:', ghostColored);
  if (!ghostColored) fails.push('T6 ghost colorless');

  // T7: серия бластов — заполнить ряд через тап-страховку одиночками
  // (просто убедимся, что много дропов подряд не ломают игру)
  for (let i = 0; i < 20; i++) {
    const has = await page.evaluate(() => document.querySelectorAll('.piece-slot:not(.used)').length);
    if (has === 0) break;
    try { await dragTo(0, (i % 8), ((i * 3) % 8)); } catch (e) { break; }
  }
  const stateOk = await page.evaluate(() => ({
    slots: document.querySelectorAll('.piece-slot').length,
    score: +document.getElementById('score').textContent,
    over: !document.getElementById('gameover').classList.contains('hidden'),
  }));
  console.log('T7 stress 20 drops:', JSON.stringify(stateOk));
  if (stateOk.slots !== 3) fails.push('T7 dock broken after stress');

  await page.screenshot({ path: '/workspace/screenshot.png' });

  console.log('errors:', JSON.stringify(errors));
  if (errors.length) fails.push('JS errors');
  console.log(fails.length ? 'FAIL: ' + fails.join('; ') : 'ALL TESTS PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
