const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 1100 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  // Симулируем «битый» старый CSS: без классов .cN — цвета теперь из JS
  await page.goto('file:///workspace/index.html');
  await page.addStyleTag({ content: '.c0,.c1,.c2,.c3,.c4,.c5,.c6{background:transparent !important}' });
  await new Promise(r => setTimeout(r, 300));

  async function slotCenter(i) {
    return page.evaluate(idx => {
      const s = document.querySelectorAll('.piece-slot:not(.used)')[idx];
      const r = s.getBoundingClientRect();
      return { x: r.x + r.width/2, y: r.y + r.height/2 };
    }, i);
  }
  const boardBox = await page.evaluate(() => {
    const b = document.getElementById('board').getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height, cx: b.x + b.width/2, cy: b.y + b.height/2 };
  });

  const filledCount = () => page.evaluate(() => document.querySelectorAll('.cell.filled').length);
  const visibleFilled = () => page.evaluate(() => [...document.querySelectorAll('.cell.filled')].filter(el => {
    const bg = getComputedStyle(el).backgroundColor;
    return bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
  }).length);

  let fails = [];

  // T1: drag 1x1 в центр
  let before = await filledCount();
  let p = await slotCenter(0);
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  await page.mouse.move(boardBox.cx, boardBox.cy, { steps: 10 }); await page.mouse.up();
  await new Promise(r => setTimeout(r, 150));
  let after = await filledCount();
  console.log('T1 drag:', before, '->', after);
  if (after <= before) fails.push('T1 drag placement');

  // T2: drag большой фигуры с прицелом в левый нижний угол — не должна вылезать
  before = after;
  p = await slotCenter(0);
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  await page.mouse.move(boardBox.x + 15, boardBox.y + boardBox.h - 15, { steps: 10 }); await page.mouse.up();
  await new Promise(r => setTimeout(r, 150));
  after = await filledCount();
  console.log('T2 corner drag:', before, '->', after);
  if (after <= before) fails.push('T2 corner drag');

  // T3: клик-клик
  before = after;
  p = await slotCenter(0);
  await page.mouse.click(p.x, p.y);
  await new Promise(r => setTimeout(r, 80));
  const sel = await page.evaluate(() => !!document.querySelector('.piece-slot.selected'));
  await page.mouse.click(boardBox.cx + 60, boardBox.cy + 60);
  await new Promise(r => setTimeout(r, 150));
  after = await filledCount();
  console.log('T3 click-click: selected=', sel, before, '->', after);
  if (!sel || after <= before) fails.push('T3 click-click');

  // T4: неудачный дроп на занятую клетку — фигура остаётся и выделяется
  const usedBefore = await page.evaluate(() => document.querySelectorAll('.piece-slot.used').length);
  // fill entire top-left 4x4 region with a big shape first? Simpler: drop piece exactly on an occupied cell repeatedly
  before = after;
  p = await slotCenter(0);
  // find an occupied cell
  const occ = await page.evaluate(() => {
    const el = document.querySelector('.cell.filled');
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2 };
  });
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  await page.mouse.move(occ.x, occ.y, { steps: 10 }); await page.mouse.up();
  await new Promise(r => setTimeout(r, 150));
  after = await filledCount();
  const stillSelected = await page.evaluate(() => !!document.querySelector('.piece-slot.selected'));
  console.log('T4 bad drop:', before, '->', after, '(may place elsewhere via clamp; key: no crash), reselected=', stillSelected);

  // T5: цвета видны даже при «убитых» классах cN (inline fallback)
  const vis = await visibleFilled();
  const tot = await filledCount();
  console.log('T5 colors: visible filled =', vis, '/', tot);
  if (tot > 0 && vis !== tot) fails.push('T5 invisible blocks');

  // T6: док-фигуры видимы при битых классах
  const dockVis = await page.evaluate(() => [...document.querySelectorAll('.piece-slot:not(.used) .piece-cell:not(.empty)')].every(el => {
    const bg = getComputedStyle(el).backgroundColor;
    return bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
  }));
  console.log('T6 dock colors visible:', dockVis);
  if (!dockVis) fails.push('T6 dock invisible');

  // T7: ghost во время drag имеет цвет
  p = await slotCenter(0);
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  await page.mouse.move(boardBox.cx, boardBox.cy, { steps: 5 });
  const ghostColored = await page.evaluate(() => [...document.querySelectorAll('#ghost .piece-cell:not(.empty)')].every(el => {
    const bg = getComputedStyle(el).backgroundColor;
    return bg !== 'rgba(0, 0, 0, 0)';
  }));
  await page.mouse.up();
  console.log('T7 ghost colored:', ghostColored);
  if (!ghostColored) fails.push('T7 ghost colorless');

  console.log('errors:', errors);
  if (errors.length) fails.push('JS errors');
  console.log(fails.length ? 'FAIL: ' + fails.join('; ') : 'ALL TESTS PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
