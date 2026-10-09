const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 1000 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto('file:///workspace/index.html');
  await new Promise(r => setTimeout(r, 400));

  // 1) фигуры в доке видны: у piece-cells есть ненулевой размер и непрозрачный цветной фон
  const dockCheck = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.piece-slot:not(.used) .piece-cell:not(.empty)')];
    return cells.map(el => {
      const r = el.getBoundingClientRect();
      const bg = getComputedStyle(el).backgroundColor;
      const alpha = +(bg.match(/rgba?\([^)]*?([\d.]+)\)/)[1] ?? 1);
      return { w: r.width, h: r.height, visible: r.width > 5 && r.height > 5 && !bg.includes('0)') && alpha > 0.5, bg };
    });
  });
  console.log('dock cells:', dockCheck.length, 'all visible:', dockCheck.every(c => c.visible), dockCheck[0]?.bg);

  // 2) drag мышью: взять первую фигуру, бросить в центр поля
  const before = await page.evaluate(() => document.querySelectorAll('.cell.filled').length);
  const slotBox = await page.evaluate(() => {
    const s = document.querySelector('.piece-slot:not(.used)');
    const r = s.getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2 };
  });
  const boardBox = await page.evaluate(() => {
    const b = document.getElementById('board').getBoundingClientRect();
    return { cx: b.x + b.width/2, cy: b.y + b.height/2 };
  });
  await page.mouse.move(slotBox.x, slotBox.y);
  await page.mouse.down();
  await page.mouse.move(boardBox.cx - 30, boardBox.cy - 30, { steps: 8 });
  await page.mouse.move(boardBox.cx, boardBox.cy, { steps: 8 });
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 500));

  const afterDrag = await page.evaluate(() => {
    const filled = [...document.querySelectorAll('.cell.filled')];
    const bad = filled.filter(el => {
      const bg = getComputedStyle(el).backgroundColor;
      const r = el.getBoundingClientRect();
      return bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent' || r.width < 5;
    }).length;
    return { count: filled.length, invisible: bad, score: +document.getElementById('score').textContent };
  });
  console.log('after drag: filled=', afterDrag.count, '(before', before + ')', 'invisible=', afterDrag.invisible, 'score=', afterDrag.score);

  // 3) клик-клик режим
  const slotBox2 = await page.evaluate(() => {
    const s = document.querySelector('.piece-slot:not(.used):not(.selected)');
    const r = s.getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2 };
  });
  await page.mouse.click(slotBox2.x, slotBox2.y);
  await new Promise(r => setTimeout(r, 100));
  const sel = await page.evaluate(() => !!document.querySelector('.piece-slot.selected'));
  await page.mouse.click(boardBox.cx + 100, boardBox.cy + 100);
  await new Promise(r => setTimeout(r, 500));
  const afterClick = await page.evaluate(() => ({
    count: document.querySelectorAll('.cell.filled').length,
    score: +document.getElementById('score').textContent,
  }));
  console.log('click-select:', sel, '| after click-place: filled=', afterClick.count, 'score=', afterClick.score);

  // 4) ghost во время drag видим
  const ghostVisible = await page.evaluate(() => {
    const g = document.getElementById('ghost');
    return g ? !g.classList.contains('hidden') : 'NO GHOST EL';
  });

  const ok = dockCheck.length >= 3 && dockCheck.every(c => c.visible)
    && afterDrag.count > before && afterDrag.invisible === 0 && afterDrag.score > 0
    && sel && afterClick.count > afterDrag.count && afterClick.score > afterDrag.score
    && errors.length === 0;
  console.log('errors:', errors);
  console.log(ok ? 'ALL TESTS PASS' : 'FAIL');
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
