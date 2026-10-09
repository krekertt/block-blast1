const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 1100 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  await page.goto('file:///workspace/index.html');
  // Симулируем старый/битый CSS — цвета должны выжить (inline из JS)
  await page.addStyleTag({ content: '.c0,.c1,.c2,.c3,.c4,.c5,.c6{background:transparent !important}' });
  await new Promise(r => setTimeout(r, 300));

  const shapeOf = i => page.evaluate(idx => {
    const s = document.querySelectorAll('.piece-slot:not(.used)')[idx];
    return JSON.parse(s.dataset.testshape || 'null') || [...s.querySelectorAll('.piece-grid')][0] ? (() => {
      const g = s.querySelector('.piece-grid');
      const cols = getComputedStyle(g).gridTemplateColumns.split(' ').length;
      const cells = [...g.querySelectorAll('.piece-cell')];
      const rows = Math.ceil(cells.length / cols);
      const m = [];
      for (let r = 0; r < rows; r++) m.push(cells.slice(r*cols,(r+1)*cols).map(c => c.classList.contains('empty') ? 0 : 1));
      return { m, rows, cols };
    })() : null;
  }, i);

  async function slotCenter(i) {
    return page.evaluate(idx => {
      const s = document.querySelectorAll('.piece-slot:not(.used)')[idx];
      const r = s.getBoundingClientRect();
      return { x: r.x + r.width/2, y: r.y + r.height/2 };
    }, idx => idx, i) || page.evaluate(idx => {
      const s = document.querySelectorAll('.piece-slot:not(.used)')[idx];
      const r = s.getBoundingClientRect();
      return { x: r.x + r.width/2, y: r.y + r.height/2 };
    }, i);
  }

  const boardBox = await page.evaluate(() => {
    const b = document.getElementById('board').getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height, cx: b.x + b.width/2, cy: b.y + b.height/2 };
  });
  const cellPx = (boardBox.w - 16) / 8; // padding 8px
  const cellCenter = (r, c) => ({ x: boardBox.x + 8 + c*cellPx + cellPx/2 - (cellPx-4)/2 + (cellPx-4)/2, y: 0 }); // simplified below
  const cc = (r, c) => ({ x: boardBox.x + 8 + c*cellPx + (cellPx)/2, y: boardBox.y + 8 + r*cellPx + cellPx/2 });

  const filledCount = () => page.evaluate(() => document.querySelectorAll('.cell.filled').length);
  const visibleFilled = () => page.evaluate(() => [...document.querySelectorAll('.cell.filled')].filter(el => {
    const bg = getComputedStyle(el).backgroundColor;
    return bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
  }).length);

  let fails = [];

  // T1: drag фигуры 0 в её свободную позицию (центр поля подходит на пустой доске)
  const sh0 = await shapeOf(0);
  console.log('shape0:', JSON.stringify(sh0.m));
  let p = await slotCenter(0);
  let before = await filledCount();
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  const t1 = cc(4, 4);
  await page.mouse.move(t1.x, t1.y, { steps: 10 }); await page.mouse.up();
  await new Promise(r => setTimeout(r, 150));
  let after = await filledCount();
  console.log('T1 drag to (4,4):', before, '->', after);
  if (after <= before) fails.push('T1 drag placement');

  // T2: клик-клик точно на клетку (0,0)
  p = await slotCenter(0);
  await page.mouse.click(p.x, p.y);
  await new Promise(r => setTimeout(r, 80));
  const sel = await page.evaluate(() => !!document.querySelector('.piece-slot.selected'));
  const t2 = cc(0, 0);
  await page.mouse.click(t2.x, t2.y);
  await new Promise(r => setTimeout(r, 150));
  after = await filledCount();
  console.log('T2 click-click to (0,0): selected=', sel, 'filled now=', after);
  if (!sel) fails.push('T2 select');

  // T3: drag у края — фигура прижимается, ставится
  before = after;
  p = await slotCenter(0);
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  const t3 = cc(7, 7);
  await page.mouse.move(t3.x, t3.y, { steps: 10 }); await page.mouse.up();
  await new Promise(r => setTimeout(r, 150));
  after = await filledCount();
  console.log('T3 corner drag:', before, '->', after);
  if (after <= before) fails.push('T3 corner drag');

  // T4: цвета невидимок нет (при убитых классах cN inline-фон спасает)
  const vis = await visibleFilled(), tot = await filledCount();
  console.log('T4 colors: visible=', vis, '/', tot);
  if (tot === 0 || vis !== tot) fails.push('T4 invisible blocks');

  // T5: ghost окрашен во время drag
  p = await slotCenter(0);
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  await page.mouse.move(cc(3,3).x, cc(3,3).y, { steps: 5 });
  const ghostColored = await page.evaluate(() => {
    const cs = [...document.querySelectorAll('#ghost .piece-cell:not(.empty)')];
    return cs.length > 0 && cs.every(el => getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)');
  });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  console.log('T5 ghost colored:', ghostColored);
  if (!ghostColored) fails.push('T5 ghost colorless');

  // T6: док окрашен
  const dockVis = await page.evaluate(() => {
    const cs = [...document.querySelectorAll('.piece-slot:not(.used) .piece-cell:not(.empty)')];
    return cs.length >= 3 && cs.every(el => {
      const bg = getComputedStyle(el).backgroundColor;
      const r = el.getBoundingClientRect();
      return bg !== 'rgba(0, 0, 0, 0)' && r.width > 5;
    });
  });
  console.log('T6 dock colored:', dockVis);
  if (!dockVis) fails.push('T6 dock invisible');

  console.log('errors:', errors);
  if (errors.length) fails.push('JS errors');
  console.log(fails.length ? 'FAIL: ' + fails.join('; ') : 'ALL TESTS PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
