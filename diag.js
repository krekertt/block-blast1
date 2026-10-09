const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({args:['--no-sandbox','--disable-setuid-sandbox']});
  const page = await browser.newPage();
  await page.setViewport({width:480, height:900});
  page.on('pageerror', e=>console.log('PAGEERROR:',e.message));
  await page.goto('file:///workspace/index.html');
  await new Promise(r=>setTimeout(r,300));
  // instrument events
  await page.evaluate(() => {
    window.__log = [];
    ['pointerdown','pointermove','pointerup'].forEach(n =>
      window.addEventListener(n, e => window.__log.push([n, Math.round(e.clientX), Math.round(e.clientY)]), true));
  });
  const client = await page.createCDPSession();
  const mouse = (type,x,y,b=0)=>client.send('Input.dispatchMouseEvent',{type,x,y,buttons:b,clickCount:type==='mousePressed'?1:0,button:'left'});

  const slot = await page.evaluate(()=>{const s=document.querySelector('.piece-slot:not(.used)');const b=s.getBoundingClientRect();return{x:b.left+b.width/2,y:b.top+b.height/2};});
  const cell = await page.evaluate(()=>{const c=document.querySelector('.cell[data-r="3"][data-c="3"]');const b=c.getBoundingClientRect();return{x:b.left+b.width/2,y:b.top+b.height/2};});
  console.log('slot',slot,'cell',cell);
  await mouse('mousePressed', slot.x, slot.y, 1);
  for(let i=1;i<=8;i++){ await mouse('mouseMoved', slot.x+(cell.x-slot.x)*i/8, slot.y+(cell.y-slot.y)*i/8, 1); await new Promise(r=>setTimeout(r,15)); }
  await mouse('mouseReleased', cell.x, cell.y, 0);
  await new Promise(r=>setTimeout(r,150));
  const res = await page.evaluate(()=>({
    log: window.__log.slice(0,3).concat(window.__log.slice(-3)),
    count: window.__log.length,
    used: document.querySelectorAll('.piece-slot.used').length,
    ghostHidden: document.getElementById('ghost').classList.contains('hidden'),
  }));
  console.log(JSON.stringify(res,null,1));
  await browser.close();
})();
