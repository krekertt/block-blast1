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

  // --- TEST A: точное размещение: ставим фигуру и сверяем board с превью
  let passA = true;
  for (let trial=0; trial<6; trial++) {
    await page.evaluate(()=>restart());
    await new Promise(r=>setTimeout(r,80));
    const s = await slotPos(0);
    const r=(2+trial)%7, c=(1+trial)%7;
    const t = await cellCenter(r,c);
    // где встанет? читаем board после
    await drag(s,t);
    const placedOn = await page.evaluate((r,c)=>{
      // клетка под курсором должна быть занята (привязка по центру bbox)
      return board[r][c] !== null;
    }, r, c);
    if (!placedOn) { passA=false; console.log('A FAIL trial',trial,'cursor cell empty after drop'); }
  }
  console.log('TEST A cursor-cell always covered:', passA?'PASS':'FAIL');

  // --- TEST B: серия ходов «вплотную» — заполняем ряд 7 до бласта
  await page.evaluate(()=>restart());
  await new Promise(r=>setTimeout(r,80));
  // вручную расставим горизонтальные 5-линии и 2-линии через API-подобные клики: проще — fill board через evaluate + placePiece недоступен... используем штатный путь: много дропов
  let blasted = false;
  for (let i=0;i<80 && !blasted;i++){
    const over = await page.evaluate(()=>!document.getElementById('gameover').classList.contains('hidden'));
    if (over) break;
    const avail = await page.evaluate(()=>document.querySelectorAll('.piece-slot:not(.used)').length);
    if (!avail) break;
    // strategy: aim pieces at row 0 left-to-right to complete it
    const targetCol = (i*3)%8;
    const s = await slotPos(0);
    const t = await cellCenter(0, Math.min(7,targetCol+2));
    await drag(s,t);
    const sc = await page.evaluate(()=>+document.getElementById('score').textContent);
    if (sc >= 80) blasted = true; // line bonus ~ 8*10*... definitely >80 only on clear
  }
  console.log('TEST B blast via UI reachable:', blasted?'PASS':'CHECK', 'score=', await page.evaluate(()=>document.getElementById('score').textContent));

  // --- TEST C: быстрый «щелчок» drag (без промежуточных move) — тоже должен ставить
  await page.evaluate(()=>restart());
  await new Promise(r=>setTimeout(r,80));
  {
    const s = await slotPos(0), t = await cellCenter(4,4);
    await mouse('mousePressed', s.x, s.y, 1);
    await mouse('mouseMoved', t.x, t.y, 1);
    await mouse('mouseReleased', t.x, t.y, 0);
    await new Promise(r=>setTimeout(r,100));
    const used = await page.evaluate(()=>document.querySelectorAll('.piece-slot.used').length);
    console.log('TEST C fast single-move drag:', used===1?'PASS':'FAIL');
  }

  // --- TEST D: отпустил за пределами поля — фигура НЕ пропадает, ghost скрыт
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
    console.log('TEST D drop outside board:', (st.used===0&&st.ghostHidden&&!st.dragging)?'PASS':'FAIL', JSON.stringify(st));
  }

  console.log('errors:', errors.length?errors.join('\n'):'none');
  await browser.close();
})();
