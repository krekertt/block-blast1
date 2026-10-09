const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({args:['--no-sandbox','--disable-setuid-sandbox']});
  const page = await browser.newPage();
  await page.setViewport({width:480, height:900});
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: '+e.message));
  await page.goto('file:///workspace/index.html');
  await new Promise(r=>setTimeout(r,300));

  // force a known big piece (5-line) as slot 0 to test center-snapping
  await page.evaluate(() => {
    pieces[0] = { shape: SHAPES.find(s=>s.m.length===1&&s.m[0].length===5), color: 1, used: false };
    renderPieces();
  });

  const client = await page.createCDPSession();
  const mouse = (type,x,y,b=0)=>client.send('Input.dispatchMouseEvent',{type,x,y,buttons:b,clickCount:type==='mousePressed'?1:0,button:'left'});
  const state = async () => page.evaluate(() => ({
    filledCells: [...document.querySelectorAll('.cell.filled')].map(c=>c.dataset.r+','+c.dataset.c),
    usedSlots: document.querySelectorAll('.piece-slot.used').length,
    ghostHidden: document.getElementById('ghost').classList.contains('hidden'),
  }));
  const slotPos = i => page.evaluate(i => {
    const s = [...document.querySelectorAll('.piece-slot:not(.used)')][i];
    const b = s.getBoundingClientRect(); return {x:b.left+b.width/2, y:b.top+b.height/2};
  }, i);
  const cellCenter = (r,c) => page.evaluate((r,c) => {
    const el = document.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
    const b = el.getBoundingClientRect(); return {x:b.left+b.width/2, y:b.top+b.height/2};
  }, r, c);

  async function drag(s,t){
    await mouse('mousePressed', s.x, s.y, 1);
    await mouse('mouseMoved', (s.x+t.x)/2, (s.y+t.y)/2, 1);
    await new Promise(r=>setTimeout(r,20));
    await mouse('mouseMoved', t.x, t.y, 1);
    await new Promise(r=>setTimeout(r,20));
    await mouse('mouseReleased', t.x, t.y, 0);
    await new Promise(r=>setTimeout(r,120));
  }

  // aim at cell (3,3) with the 5-long horizontal piece -> expect cells row3 cols1..3? 
  // center of bbox is col index 2 -> br=3, bc=3-? ocx=(5-1)/2=2 -> bc=round(fx-2)=3-2=1 => cells (3,1)..(3,5)
  let s = await slotPos(0);
  let t = await cellCenter(3,3);
  await drag(s,t);
  let st = await state();
  console.log('big piece drop:', JSON.stringify(st));
  const expect = ['3,1','3,2','3,3','3,4','3,5'].sort().join(' ');
  const got = st.filledCells.sort().join(' ');
  console.log('aimed-at-center placement:', got===expect ? 'PASS (centered on cursor cell)' : 'FAIL exp='+expect+' got='+got);

  // near-edge aiming: aim at (0,0) -> should clamp, still place
  await page.reload(); await new Promise(r=>setTimeout(r,200));
  await page.evaluate(() => {
    pieces[0] = { shape: SHAPES.find(s=>s.m.length===1&&s.m[0].length===5), color: 1, used: false };
    renderPieces();
  });
  s = await slotPos(0); t = await cellCenter(0,0);
  await drag(s,t);
  st = await state();
  console.log('edge-clamped drop:', st.usedSlots===1?'PASS':'FAIL', JSON.stringify(st.filledCells));

  // full playthrough loop until game over — verify no stuck/lost pieces
  await page.reload(); await new Promise(r=>setTimeout(r,200));
  let moves=0, lastScore=-1;
  for(let i=0;i<120;i++){
    const over = await page.evaluate(()=>!document.getElementById('gameover').classList.contains('hidden'));
    if (over) break;
    const avail = await page.evaluate(()=>document.querySelectorAll('.piece-slot:not(.used)').length);
    if (!avail) break;
    s = await slotPos(0);
    const r=(Math.random()*8)|0, c=(Math.random()*8)|0;
    t = await cellCenter(r,c);
    await drag(s,t);
    const sc = await page.evaluate(()=>+document.getElementById('score').textContent);
    const used = await page.evaluate(()=>document.querySelectorAll('.piece-slot.used').length);
    // ghost must never remain visible when idle
    const gh = await page.evaluate(()=>document.getElementById('ghost').classList.contains('hidden'));
    if (!gh) { console.log('FAIL: ghost stuck visible after move', i); break; }
    if (sc === lastScore) { /* placement may legitimately fail onto occupied cell */ }
    else { moves++; lastScore = sc; }
  }
  const fin = await page.evaluate(()=>({
    score:+document.getElementById('score').textContent,
    over:!document.getElementById('gameover').classList.contains('hidden'),
    anyUsedStuck: !!document.querySelector('.piece-slot.dragging'),
  }));
  console.log('playthrough:', JSON.stringify(fin), 'successful moves:', moves, fin.score>0 && moves>=3 ? 'PASS':'CHECK');
  console.log('errors:', errors.length?errors.join('\n'):'none');
  await browser.close();
})();
