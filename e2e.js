// E2E: реальные события мыши через CDP Input.dispatchMouseEvent (pointer-события генерируются браузером)
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({args:['--no-sandbox','--disable-setuid-sandbox']});
  const page = await browser.newPage();
  await page.setViewport({width:480, height:900});
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: '+e.message));
  page.on('console', m => { if (m.type()==='error') errors.push('CONSOLE: '+m.text()); });
  await page.goto('file:///workspace/index.html');
  await new Promise(r=>setTimeout(r,300));

  // helper: dispatch raw mouse event via CDP
  const client = await page.createCDPSession();
  async function mouse(type, x, y, buttons=0) {
    await client.send('Input.dispatchMouseEvent', {type, x, y, buttons, clickCount: type==='mousePressed'?1:(type==='mouseReleased'?1:0), button:'left'});
  }
  async function dragTo(sx, sy, tx, ty) {
    await mouse('mousePressed', sx, sy, 1);
    const steps = 12;
    for (let i=1;i<=steps;i++){
      await mouse('mouseMoved', sx+(tx-sx)*i/steps, sy+(ty-sy)*i/steps, 1);
      await new Promise(r=>setTimeout(r,15));
    }
    await mouse('mouseReleased', tx, ty, 0);
    await new Promise(r=>setTimeout(r,100));
  }

  const state = async () => page.evaluate(() => ({
    filled: document.querySelectorAll('.cell.filled').length,
    usedSlots: document.querySelectorAll('.piece-slot.used').length,
    score: +document.getElementById('score').textContent,
    ghostVisible: !document.getElementById('ghost').classList.contains('hidden'),
  }));

  console.log('initial:', JSON.stringify(await state()));

  // grab first piece slot center
  const slotBox = await page.evaluate(() => {
    const s = document.querySelector('.piece-slot:not(.used)');
    const b = s.getBoundingClientRect();
    return {x: b.left+b.width/2, y: b.top+b.height/2};
  });
  // target: cell (3,3) center
  const cellBox = await page.evaluate(() => {
    const c = document.querySelector('.cell[data-r="3"][data-c="3"]');
    const b = c.getBoundingClientRect();
    return {x: b.left+b.width/2, y: b.top+b.height/2};
  });

  // mid-drag check: ghost should follow pointer
  await mouse('mousePressed', slotBox.x, slotBox.y, 1);
  await mouse('mouseMoved', (slotBox.x+cellBox.x)/2, (slotBox.y+cellBox.y)/2, 1);
  await new Promise(r=>setTimeout(r,50));
  const mid = await state();
  console.log('mid-drag ghost visible:', mid.ghostVisible);
  await mouse('mouseReleased', cellBox.x, cellBox.y, 0);
  await new Promise(r=>setTimeout(r,150));
  const after = await state();
  console.log('after drop:', JSON.stringify(after));

  if (after.usedSlots < 1) {
    console.log('FAIL: piece not placed on mouse drag');
  } else {
    console.log('OK: mouse drag placement works');
  }

  // second drag — place another piece
  const slot2 = await page.evaluate(() => {
    const s = [...document.querySelectorAll('.piece-slot:not(.used)')][0];
    const b = s.getBoundingClientRect();
    return {x: b.left+b.width/2, y: b.top+b.height/2};
  });
  const cell2 = await page.evaluate(() => {
    const c = document.querySelector('.cell[data-r="6"][data-c="6"]');
    const b = c.getBoundingClientRect();
    return {x: b.left+b.width/2, y: b.top+b.height/2};
  });
  await dragTo(slot2.x, slot2.y, cell2.x, cell2.y);
  const after2 = await state();
  console.log('after 2nd drop:', JSON.stringify(after2));

  // click-select fallback test: reload fresh, click piece then click board
  await page.reload();
  await new Promise(r=>setTimeout(r,200));
  const s3 = await page.evaluate(() => {
    const el = document.querySelector('.piece-slot:not(.used)');
    const b = el.getBoundingClientRect();
    return {x:b.left+b.width/2, y:b.top+b.height/2};
  });
  await mouse('mousePressed', s3.x, s3.y, 1);
  await mouse('mouseReleased', s3.x, s3.y, 0);
  await new Promise(r=>setTimeout(r,80));
  const sel = await page.evaluate(()=> !!document.querySelector('.piece-slot.selected'));
  console.log('click-select highlights piece:', sel);
  const c4 = await page.evaluate(() => {
    const c = document.querySelector('.cell[data-r="0"][data-c="0"]');
    const b = c.getBoundingClientRect();
    return {x:b.left+b.width/2, y:b.top+b.height/2};
  });
  await mouse('mousePressed', c4.x, c4.y, 1);
  await mouse('mouseReleased', c4.x, c4.y, 0);
  await new Promise(r=>setTimeout(r,120));
  const after3 = await state();
  console.log('after click-place:', JSON.stringify(after3));

  console.log('errors:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})();
