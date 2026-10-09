const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({args:['--no-sandbox','--disable-setuid-sandbox']});
  const page = await browser.newPage();
  await page.setViewport({width:480, height:900});
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: '+e.message));
  await page.goto('file:///workspace/index.html');
  await new Promise(r=>setTimeout(r,300));

  const client = await page.createCDPSession();
  async function mouse(type, x, y, buttons=0) {
    await client.send('Input.dispatchMouseEvent', {type, x, y, buttons, clickCount: type==='mousePressed'?1:0, button:'left'});
  }
  const state = async () => page.evaluate(() => ({
    filled: document.querySelectorAll('.cell.filled').length,
    usedSlots: document.querySelectorAll('.piece-slot.used').length,
    score: +document.getElementById('score').textContent,
    selected: !!document.querySelector('.piece-slot.selected'),
  }));
  const slotPos = i => page.evaluate(i => {
    const s = [...document.querySelectorAll('.piece-slot:not(.used)')][i];
    const b = s.getBoundingClientRect(); return {x:b.left+b.width/2, y:b.top+b.height/2};
  }, i);
  const cellPos = (r,c) => page.evaluate((r,c) => {
    const el = document.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
    const b = el.getBoundingClientRect(); return {x:b.left+b.width/2, y:b.top+b.height/2};
  }, r, c);

  // ТЕСТ 1: drag с «залипшим» pointerup — координаты в pointerup совпадают с последним move (норма).
  // ТЕСТ 1b: имитация багованного браузера: перехватываем pointerup и меняем clientX/Y на стартовые? 
  //   Проще: проверить что drop использует lastX — сделаем быстрый drag без последнего move точно в цель:
  {
    const s = await slotPos(0), t = await cellPos(3,3);
    await mouse('mousePressed', s.x, s.y, 1);
    await mouse('mouseMoved', t.x, t.y, 1); // последний move — точно в цель
    await mouse('mouseReleased', s.x, s.y, 0); // pointerup врёт: координаты вернулись к старту!
    await new Promise(r=>setTimeout(r,120));
    const st = await state();
    console.log('TEST stale-pointerup drop:', JSON.stringify(st), st.usedSlots>=1?'PASS':'FAIL');
  }

  // ТЕСТ 2: чистый клик по фигуре -> выделяется, затем клик по полю -> ставится
  {
    const s = await slotPos(0);
    await mouse('mousePressed', s.x, s.y, 1);
    await mouse('mouseReleased', s.x, s.y, 0);
    await new Promise(r=>setTimeout(r,80));
    let st = await state();
    console.log('TEST click-select:', st.selected?'PASS':'FAIL');
    const t = await cellPos(5,5);
    await mouse('mousePressed', t.x, t.y, 1);
    await mouse('mouseReleased', t.x, t.y, 0);
    await new Promise(r=>setTimeout(r,120));
    st = await state();
    console.log('TEST click-place:', JSON.stringify(st), st.usedSlots>=1?'PASS':'FAIL');
  }

  // ТЕСТ 3: обычный полноценный drag
  {
    const s = await slotPos(0), t = await cellPos(1,1);
    await mouse('mousePressed', s.x, s.y, 1);
    for (let i=1;i<=8;i++){ await mouse('mouseMoved', s.x+(t.x-s.x)*i/8, s.y+(t.y-s.y)*i/8, 1); await new Promise(r=>setTimeout(r,10)); }
    await mouse('mouseReleased', t.x, t.y, 0);
    await new Promise(r=>setTimeout(r,120));
    const st = await state();
    console.log('TEST normal drag:', JSON.stringify(st), st.usedSlots>=1?'PASS':'FAIL');
  }

  // ТЕСТ 4: fill a row via placements loop to test blast still works — place pieces until line clears or 60 tries
  {
    let blasted=false;
    for(let i=0;i<40;i++){
      const info = await page.evaluate(()=>({used: [...document.querySelectorAll('.piece-slot.used')].length}));
      if (info.used===0){ /* wave refreshed */ }
      const avail = await page.evaluate(()=> document.querySelectorAll('.piece-slot:not(.used)').length);
      if (!avail) break;
      const s = await slotPos(0);
      // pick random empty-ish target
      const r = (Math.random()*8)|0, c=(Math.random()*8)|0;
      const t = await cellPos(r,c);
      await mouse('mousePressed', s.x, s.y, 1);
      await mouse('mouseMoved', t.x, t.y, 1);
      await new Promise(r=>setTimeout(r,10));
      await mouse('mouseReleased', t.x, t.y, 0);
      await new Promise(r=>setTimeout(r,60));
      const sc = await page.evaluate(()=>+document.getElementById('score').textContent);
      const over = await page.evaluate(()=>!document.getElementById('gameover').classList.contains('hidden'));
      if (over){ blasted='gameover-shown'; break; }
      if (sc >= 70) { blasted=true; break; } // line clear bonus ~ 640+; just check big jump
    }
    console.log('TEST play-loop score reached:', await page.evaluate(()=>document.getElementById('score').textContent), 'blast?', blasted);
  }

  console.log('errors:', errors.length?errors.join('\n'):'none');
  await browser.close();
})();
