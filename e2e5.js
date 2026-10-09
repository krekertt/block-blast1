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
  const mouse = (type,x,y,b=0)=>client.send('Input.dispatchMouseEvent',{type,x,y,buttons:b,clickCount:type==='mousePressed'?1:0,button:'left'});
  const slotPos = i => page.evaluate(i => {
    const s = [...document.querySelectorAll('.piece-slot:not(.used)')][i];
    if(!s) return null;
    const b = s.getBoundingClientRect(); return {x:b.left+b.width/2, y:b.top+b.height/2};
  }, i);
  const cellCenter = (r,c) => page.evaluate((r,c) => {
    const el = document.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
    const b = el.getBoundingClientRect(); return {x:b.left+b.width/2, y:b.top+b.height/2};
  }, r, c);

  async function drag(s,t){
    await mouse('mousePressed', s.x, s.y, 1);
    await mouse('mouseMoved', (s.x+t.x)/2, (s.y+t.y)/2, 1);
    await new Promise(r=>setTimeout(r,25));
    await mouse('mouseMoved', t.x, t.y, 1);
    await new Promise(r=>setTimeout(r,25));
    await mouse('mouseReleased', t.x, t.y, 0);
    await new Promise(r=>setTimeout(r,80));
  }

  // TEST A: клетка под курсором всегда покрывается фигурой
  let passA = true;
  for (let trial=0; trial<6; trial++) {
    await page.evaluate(()=>restart());
    await new Promise(r=>setTimeout(r,80));
    const s = await slotPos(0);
    const r=(2+trial)%7, c=(1+trial)%7;
    const t = await cellCenter(r,c);
    await drag(s,t);
    const placedOn = await page.evaluate((r,c)=>board[r][c]!==null, r, c);
    if (!placedOn) { passA=false; console.log('A FAIL trial',trial,'cursor cell empty after drop'); }
  }
  console.log('TEST A cursor-cell covered:', passA?'PASS':'FAIL');

  // TEST B: бласт через UI — заполняем верхний ряд умно
  await page.evaluate(()=>restart());
  await new Promise(r=>setTimeout(r,80));
  let blasted = false;
  for (let i=0;i<60 && !blasted;i++){
    const info = await page.evaluate(()=>({
      over: !document.getElementById('gameover').classList.contains('hidden'),
      avail: document.querySelectorAll('.piece-slot:not(.used)').length,
      rowFilled: board[0].filter(v=>v!==null).length,
    }));
    if (info.over || !info.avail) break;
    // aim so that piece covers leftmost empty cells of row 0
    let firstEmpty = await page.evaluate(()=>{for(let c=0;c<8;c++) if(board[0][c]===null) return c; return -1;});
    if (firstEmpty < 0) { await new Promise(r=>setTimeout(r,350)); continue; }
    const aimC = Math.min(7, firstEmpty + 2); // center-ish aim; clamping keeps it in-board
    const s = await slotPos(0);
    const t = await cellCenter(0, aimC);
    await drag(s,t);
    const sc = await page.evaluate(()=>+document.getElementById('score').textContent);
    if (sc >= 80) blasted = true;
    await new Promise(r=>setTimeout(r,350)); // wait clear animation between moves near end
  }
  console.log('TEST B blast via UI:', blasted?'PASS':'FAIL', 'score=', await page.evaluate(()=>document.getElementById('score').textContent));

  // TEST C: быстрый одиночный move-drag ставит фигуру
  await page.evaluate(()=>restart());
  await new Promise(r=>setTimeout(r,80));
  {
    const s = await slotPos(0), t = await cellCenter(4,4);
    await mouse('mousePressed', s.x, s.y, 1);
    await mouse('mouseMoved', t.x, t.y, 1);
    await mouse('mouseReleased', t.x, t.y, 0);
    await new Promise(r=>setTimeout(r,100));
    const used = await page.evaluate(()=>document.querySelectorAll('.piece-slot.used').length);
    console.log('TEST C fast drag:', used===1?'PASS':'FAIL');
  }

  // TEST D: отпустил за пределами поля — фигура НЕ потрачена
  await page.evaluate(()=>restart());
  await new Promise(r=>setTimeout(r,80));
  {
    const s = await slotPos(0);
    await mouse('mousePressed', s.x, s.y, 1);
    await mouse('mouseMoved', 10, 10, 1);
    await mouse('mouseReleased', 10, 10, 0);
    await new Promise(r=>setTimeout(r,100));
    const st = await page.evaluate(()=>({
      used: document.querySelectorAll('.piece-slot.used').length,
      ghostHidden: document.getElementById('ghost').classList.contains('hidden'),
      dragging: !!document.querySelector('.piece-slot.dragging'),
    }));
    console.log('TEST D outside-drop safe:', (st.used===0&&st.ghostHidden&&!st.dragging)?'PASS':'FAIL', JSON.stringify(st));
  }

  // TEST E: клик-выбор + клик по полю (мышью)
  await page.evaluate(()=>restart());
  await new Promise(r=>setTimeout(r,80));
  {
    const s = await slotPos(0);
    await mouse('mousePressed', s.x, s.y, 1);
    await mouse('mouseReleased', s.x, s.y, 0);
    await new Promise(r=>setTimeout(r,80));
    const sel = await page.evaluate(()=>!!document.querySelector('.piece-slot.selected'));
    const t = await cellCenter(2,2);
    await mouse('mousePressed', t.x, t.y, 1);
    await mouse('mouseReleased', t.x, t.y, 0);
    await new Promise(r=>setTimeout(r,100));
    const used = await page.evaluate(()=>document.querySelectorAll('.piece-slot.used').length);
    console.log('TEST E click-select+place:', (sel&&used===1)?'PASS':'FAIL', 'sel='+sel);
  }

  // TEST F: длинная сессия случайных drag-ов — нет залипаний и ошибок
  await page.evaluate(()=>restart());
  await new Promise(r=>setTimeout(r,80));
  let placed=0;
  for(let i=0;i<50;i++){
    const over = await page.evaluate(()=>!document.getElementById('gameover').classList.contains('hidden'));
    if (over) break;
    const s = await slotPos(0); if(!s) break;
    const r=(Math.random()*8)|0, c=(Math.random()*8)|0;
    const t = await cellCenter(r,c);
    await drag(s,t);
    const st = await page.evaluate(()=>({
      ghostHidden: document.getElementById('ghost').classList.contains('hidden'),
      dragging: !!document.querySelector('.piece-slot.dragging'),
      score:+document.getElementById('score').textContent,
    }));
    if (!st.ghostHidden || st.dragging) { console.log('F FAIL stuck at iter',i,JSON.stringify(st)); break; }
    placed++;
  }
  console.log('TEST F session stability:', placed>=10?'PASS':'FAIL', 'drops attempted:', placed);

  console.log('errors:', errors.length?errors.join('\n'):'none');
  await browser.close();
})();
