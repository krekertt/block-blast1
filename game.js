/* ================= Block Blast — «удобные блоки» =================
   Механика: поле 8x8, линии (строки и столбцы) очищаются при
   заполнении. Три фигуры в доке; после размещения всех трёх —
   новая волна.

   Ключевая фишка: режим «Умные блоки». Каждая новая фигура
   оценивается по «полезности» для текущего поля (эвристика),
   и из пула фигур выбираются наиболее удобные. Уровень
   комфорта влияет на силу отбора:
     easy      — почти всегда идеальные/очень удобные фигуры
     medium    — удобные, но иногда встречаются нейтральные
     hardcore  — лёгкая подсказка, ближе к случайности
================================================================ */

const SIZE = 8;
const NCOLORS = 7;

/* ---------- пул фигур (матрицы 0/1) ---------- */
const SHAPES = [
  // одиночные и линии
  { m: [[1]], w: 6 },
  { m: [[1,1]], w: 6 },
  { m: [[1],[1]], w: 6 },
  { m: [[1,1,1]], w: 5 },
  { m: [[1],[1],[1]], w: 5 },
  { m: [[1,1,1,1]], w: 3 },
  { m: [[1],[1],[1],[1]], w: 3 },
  { m: [[1,1,1,1,1]], w: 2 },
  { m: [[1],[1],[1],[1],[1]], w: 2 },
  // квадраты
  { m: [[1,1],[1,1]], w: 5 },
  { m: [[1,1,1],[1,1,1],[1,1,1]], w: 1 },
  // уголки
  { m: [[1,0],[1,1]], w: 4 },
  { m: [[0,1],[1,1]], w: 4 },
  { m: [[1,1],[1,0]], w: 4 },
  { m: [[1,1],[0,1]], w: 4 },
  { m: [[1,0,0],[1,1,1]], w: 3 },
  { m: [[0,0,1],[1,1,1]], w: 3 },
  { m: [[1,1,1],[1,0,0]], w: 3 },
  { m: [[1,1,1],[0,0,1]], w: 3 },
  { m: [[1,1,0],[0,1,1]], w: 3 },
  { m: [[0,1,1],[1,1,0]], w: 3 },
  // T-фигуры
  { m: [[1,1,1],[0,1,0]], w: 3 },
  { m: [[0,1,0],[1,1,1]], w: 3 },
  { m: [[1,0],[1,1],[1,0]], w: 3 },
  { m: [[0,1],[1,1],[0,1]], w: 3 },
  // S/Z/L большие
  { m: [[1,0],[1,1],[0,1]], w: 2 },
  { m: [[0,1],[1,1],[1,0]], w: 2 },
  { m: [[1,0,0],[1,0,0],[1,1,1]], w: 2 },
  { m: [[0,0,1],[0,0,1],[1,1,1]], w: 2 },
];

/* ---------- состояние ---------- */
let board = [];          // null | цвет(0..NCOLORS-1)
let pieces = [null, null, null]; // {shape, color, used}
let score = 0;
let best = +(localStorage.getItem('bb_best') || 0);
let comboChain = 0;      // линии, очищенные подряд (без «пустого» хода)
let smartOn = true;
let smartLevel = 'easy';

/* ---------- DOM ---------- */
const boardEl = document.getElementById('board');
const piecesEl = document.getElementById('pieces');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const toastEl = document.getElementById('toast');
const ghostEl = document.getElementById('ghost');
const overEl = document.getElementById('gameover');
const finalEl = document.getElementById('finalScore');
const smartChk = document.getElementById('smartMode');
const levelSel = document.getElementById('smartLevel');

/* ---------- построение поля ---------- */
const cells = [];
for (let r = 0; r < SIZE; r++) {
  cells.push([]);
  for (let c = 0; c < SIZE; c++) {
    const d = document.createElement('div');
    d.className = 'cell';
    d.dataset.r = r; d.dataset.c = c;
    boardEl.appendChild(d);
    cells[r].push(d);
  }
}

function renderBoard() {
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) {
      const el = cells[r][c];
      el.classList.remove('preview', 'preview-bad');
      const v = board[r][c];
      el.className = 'cell' + (v === null ? '' : ` filled c${v}`);
    }
}

/* ---------- вспомогательное ---------- */
function shapeCells(sh) {
  const out = [];
  sh.forEach((row, r) => row.forEach((v, c) => { if (v) out.push([r, c]); }));
  return out;
}

function canPlace(sh, br, bc) {
  for (const [r, c] of shapeCells(sh)) {
    const rr = br + r, cc = bc + c;
    if (rr < 0 || cc < 0 || rr >= SIZE || cc >= SIZE) return false;
    if (board[rr][cc] !== null) return false;
  }
  return true;
}

function allPlacements(sh) {
  const res = [];
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++)
      if (canPlace(sh, r, c)) res.push([r, c]);
  return res;
}

function linesToClear(bd) {
  const rows = [], cols = [];
  for (let r = 0; r < SIZE; r++) if (bd[r].every(v => v !== null)) rows.push(r);
  for (let c = 0; c < SIZE; c++) {
    let full = true;
    for (let r = 0; r < SIZE; r++) if (bd[r][c] === null) { full = false; break; }
    if (full) cols.push(c);
  }
  return { rows, cols };
}

function countFilled(bd) {
  let n = 0;
  for (const row of bd) for (const v of row) if (v !== null) n++;
  return n;
}

/* =========================================================
   ЭВРИСТИКА «УДОБСТВА» фигуры для текущего поля.
   Чем выше значение — тем полезнее/удобнее фигура.
   ========================================================= */
function pieceUsefulness(shape) {
  const placements = allPlacements(shape.m);
  if (placements.length === 0) return -Infinity; // вообще некуда — худший вариант

  let bestScore = -Infinity;
  const cellsN = shapeCells(shape.m).length;

  for (const [br, bc] of placements) {
    // копируем поле и ставим фигуру
    const nb = board.map(row => row.slice());
    for (const [r, c] of shapeCells(shape.m)) nb[br + r][bc + c] = 99;

    const { rows, cols } = linesToClear(nb);
    const cleared = rows.length + cols.length;

    let s = 0;

    // 1) очистка линий — главный бонус
    s += cleared * 100;
    if (cleared >= 2) s += cleared * cleared * 25; // комбо

    // 2) «почти готовые» линии: после установки насколько близко
    //    оставшиеся незаполненные линии к завершению
    let nearBonus = 0;
    for (let r = 0; r < SIZE; r++) {
      if (rows.includes(r)) continue;
      const empties = nb[r].filter(v => v === null).length;
      if (empties <= 2) nearBonus += (3 - empties) * 6;
    }
    for (let c = 0; c < SIZE; c++) {
      if (cols.includes(c)) continue;
      let e = 0;
      for (let r = 0; r < SIZE; r++) if (nb[r][c] === null) e++;
      if (e <= 2) nearBonus += (3 - e) * 6;
    }
    s += nearBonus;

    // 3) компактность поля: штрафуем изолированные «карманы» —
    //    пустые клетки, окружённые заполненными слева/сверху/снизу
    let holes = 0;
    for (let r = 1; r < SIZE - 1; r++)
      for (let c = 1; c < SIZE - 1; c++)
        if (nb[r][c] === null && nb[r - 1][c] !== null &&
            nb[r + 1][c] !== null && nb[r][c - 1] !== null) holes++;
    s -= holes * 12;

    // 4) бонус за большие фигуры, если они закрывают много сразу
    //    (иначе небольшой штраф за «прожигание» места)
    if (cleared > 0) s += cellsN * 4; else s -= cellsN * 1.5;

    // 5) бонус за то, что после установки все 3 фигуры волны
    //    всё ещё куда-то влезают (выживаемость) — считаем грубо:
    //    сколько клеток largest-фигуры может влезть потом
    let spaceLeft = 0;
    for (let r = 0; r < SIZE - 1; r++)
      for (let c = 0; c < SIZE - 1; c++)
        if (nb[r][c] === null && nb[r][c + 1] === null &&
            nb[r + 1][c] === null && nb[r + 1][c + 1] === null) spaceLeft++;
    s += Math.min(spaceLeft, 6) * 2;

    if (s > bestScore) bestScore = s;
  }
  return bestScore;
}

/* ---------- генерация волны фигур ---------- */
function randomShape() {
  let total = SHAPES.reduce((a, s) => a + s.w, 0);
  let x = Math.random() * total;
  for (const s of SHAPES) { x -= s.w; if (x <= 0) return s; }
  return SHAPES[0];
}

/**
 * Выбор «удобной» фигуры: берём N кандидатов случайно,
 * считаем эвристику и забираем лучшую с вероятностью
 * в зависимости от уровня комфорта.
 */
function pickSmartPiece() {
  const candCount = smartLevel === 'easy' ? 12 : smartLevel === 'medium' ? 6 : 3;
  const greed = smartLevel === 'easy' ? 0.97 : smartLevel === 'medium' ? 0.8 : 0.55;

  let bestCand = null, bestVal = -Infinity;
  for (let i = 0; i < candCount; i++) {
    const sh = randomShape();
    // кандидаты, которые вообще некуда поставить, отбрасываем
    const val = pieceUsefulness(sh);
    if (val === -Infinity) continue;
    if (val > bestVal) { bestVal = val; bestCand = sh; }
  }
  // fallback: если вообще ничего не влезает — отдаём случайную
  if (!bestCand) return { shape: randomShape(), color: (Math.random() * NCOLORS) | 0 };

  // жадный выбор с элементом случайности
  const chosen = Math.random() < greed ? bestCand : randomShape();
  return { shape: chosen, color: (Math.random() * NCOLORS) | 0 };
}

function pickRandomPiece() {
  // обычный режим: только проверка, что фигура куда-то влезает
  let sh;
  for (let tries = 0; tries < 30; tries++) {
    sh = randomShape();
    if (allPlacements(sh.m).length > 0) break;
  }
  return { shape: sh, color: (Math.random() * NCOLORS) | 0 };
}

function newWave() {
  for (let i = 0; i < 3; i++) {
    pieces[i] = smartOn ? pickSmartPiece() : pickRandomPiece();
    pieces[i].used = false;
  }
  renderPieces();
  checkGameOver();
}

/* ---------- отрисовка дока ---------- */
function renderPieces() {
  piecesEl.innerHTML = '';
  pieces.forEach((p, idx) => {
    const slot = document.createElement('div');
    slot.className = 'piece-slot' + (p.used ? ' used' : '');
    slot.dataset.idx = idx;
    if (!p.used) {
      const grid = document.createElement('div');
      grid.className = 'piece-grid';
      const rows = p.shape.m.length, cols = p.shape.m[0].length;
      grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const cell = document.createElement('div');
          cell.className = 'piece-cell' + (p.shape.m[r][c] ? ` c${p.color}` : ' empty');
          grid.appendChild(cell);
        }
      slot.appendChild(grid);
      attachDrag(slot, idx);
      // подсветка «не лезет»
      if (allPlacements(p.shape.m).length === 0) slot.classList.add('no-fit');
    }
    piecesEl.appendChild(slot);
  });
}

/* ---------- drag & drop ---------- */
let drag = null; // {idx, offsetX, offsetY}

function attachDrag(slot, idx) {
  slot.addEventListener('pointerdown', e => {
    if (pieces[idx].used) return;
    e.preventDefault();
    const p = pieces[idx];
    const cs = cellSize();
    const rows = p.shape.m.length, cols = p.shape.m[0].length;

    // строим ghost
    ghostEl.innerHTML = '';
    ghostEl.style.gridTemplateColumns = `repeat(${cols}, ${cs}px)`;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const d = document.createElement('div');
        d.className = 'piece-cell' + (p.shape.m[r][c] ? ` c${p.color}` : ' empty');
        d.style.width = cs + 'px'; d.style.height = cs + 'px';
        ghostEl.appendChild(d);
      }
    ghostEl.classList.remove('hidden');

    drag = { idx, gw: cols * cs, gh: rows * cs };
    slot.classList.add('dragging');
    moveGhost(e.clientX, e.clientY);
    ghostEl.setPointerCapture?.(e.pointerId);
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd, { once: true });
  });
}

function cellSize() {
  const rect = cells[0][0].getBoundingClientRect();
  return rect.width + 4; // + gap
}

function boardOrigin() {
  return boardEl.getBoundingClientRect();
}

// смещение: фигуру держим над пальцем (для тача) / под курсором
function moveGhost(x, y) {
  const isTouch = drag && drag.touch;
  const dy = isTouch ? -drag.gh - 20 : 0;
  ghostEl.style.left = (x - drag.gw / 2) + 'px';
  ghostEl.style.top = (y + dy - drag.gh / 2) + 'px';
  updatePreview(x, y);
}

function targetCell(x, y) {
  const o = boardOrigin();
  const cs = cellSize();
  const pad = parseFloat(getComputedStyle(boardEl).paddingLeft);
  // центр ghost (с учётом смещения для тача)
  const isTouch = drag && drag.touch;
  const cy = isTouch ? y - drag.gh - 20 + drag.gh / 2 : y;
  const cx = x;
  const p = pieces[drag.idx];
  const rows = p.shape.m.length, cols = p.shape.m[0].length;
  // координаты центра фигуры в системе поля -> клетка верхнего левого угла
  const relX = cx - o.left - pad - (cols * cs) / 2;
  const relY = cy - o.top - pad - (rows * cs) / 2;
  const bc = Math.round(relX / cs);
  const br = Math.round(relY / cs);
  return { br, bc };
}

function clearPreview() {
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++)
      cells[r][c].classList.remove('preview', 'preview-bad');
}

function updatePreview(x, y) {
  clearPreview();
  if (!drag) return;
  const p = pieces[drag.idx];
  const { br, bc } = targetCell(x, y);
  const ok = canPlace(p.shape.m, br, bc);
  for (const [r, c] of shapeCells(p.shape.m)) {
    const rr = br + r, cc = bc + c;
    if (rr >= 0 && cc >= 0 && rr < SIZE && cc < SIZE)
      cells[rr][cc].classList.add(ok ? 'preview' : 'preview-bad');
  }
}

function onDragMove(e) {
  if (!drag) return;
  drag.touch = e.pointerType === 'touch';
  moveGhost(e.clientX, e.clientY);
}

function onDragEnd(e) {
  window.removeEventListener('pointermove', onDragMove);
  if (!drag) return;
  const idx = drag.idx;
  const p = pieces[idx];
  const { br, bc } = targetCell(e.clientX, e.clientY);
  const ok = canPlace(p.shape.m, br, bc);
  ghostEl.classList.add('hidden');
  clearPreview();
  const slot = piecesEl.querySelector(`[data-idx="${idx}"]`);
  slot?.classList.remove('dragging');
  drag = null;
  if (ok) placePiece(idx, br, bc);
}

/* ---------- размещение и очистка ---------- */
function placePiece(idx, br, bc) {
  const p = pieces[idx];
  const col = p.color;
  for (const [r, c] of shapeCells(p.shape.m)) board[br + r][bc + c] = col;
  p.used = true;

  let gained = shapeCells(p.shape.m).length;
  const { rows, cols } = linesToClear(board);
  const n = rows.length + cols.length;

  if (n > 0) {
    comboChain++;
    // блокируем ввод на время анимации, чтобы избежать гонок
    boardEl.style.pointerEvents = 'none';
    const toClear = new Set();
    for (const r of rows) for (let c = 0; c < SIZE; c++) toClear.add(r * SIZE + c);
    for (const c of cols) for (let r = 0; r < SIZE; r++) toClear.add(r * SIZE + c);
    toClear.forEach(k => cells[(k / SIZE) | 0][k % SIZE].classList.add('clearing'));

    setTimeout(() => {
      toClear.forEach(k => { board[(k / SIZE) | 0][k % SIZE] = null; });
      renderBoard();
      boardEl.style.pointerEvents = '';
    }, 300);

    gained += n * 10 * SIZE;               // базовый бонус за линии
    if (n >= 2) gained += n * n * 15;      // комбо
    if (comboChain >= 2) gained += comboChain * 20; // серия чистых ходов
    showToast(comboText(n));
  } else {
    comboChain = 0;
  }

  score += gained;
  if (score > best) { best = score; localStorage.setItem('bb_best', best); }
  updateScores();
  renderPieces();

  if (pieces.every(p => p.used)) newWave();
  else checkGameOver();
}

function comboText(n) {
  if (n >= 4) return 'НЕВЕРОЯТНО! 🔥';
  if (n === 3) return 'МЕГА БЛАСТ!';
  if (n === 2) return 'ДВОЙНОЙ БЛАСТ!';
  return comboChain >= 2 ? `СЕРИЯ x${comboChain}!` : 'БЛАСТ!';
}

let toastTimer = null;
function showToast(text) {
  toastEl.textContent = text;
  toastEl.classList.remove('hidden');
  // перезапуск анимации
  toastEl.style.animation = 'none';
  void toastEl.offsetWidth;
  toastEl.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 900);
}

/* ---------- конец игры ---------- */
function anyFit() {
  return pieces.some(p => !p.used && allPlacements(p.shape.m).length > 0);
}

function checkGameOver() {
  if (!anyFit()) {
    finalEl.textContent = score;
    overEl.classList.remove('hidden');
  }
}

function updateScores() {
  scoreEl.textContent = score;
  bestEl.textContent = best;
}

/* ---------- рестарт ---------- */
function restart() {
  board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  score = 0; comboChain = 0;
  overEl.classList.add('hidden');
  updateScores();
  renderBoard();
  newWave();
}

/* ---------- настройки ---------- */
smartChk.addEventListener('change', () => { smartOn = smartChk.checked; });
levelSel.addEventListener('change', () => { smartLevel = levelSel.value; });
document.getElementById('restart').addEventListener('click', restart);
document.getElementById('againBtn').addEventListener('click', restart);

/* ---------- старт ---------- */
bestEl.textContent = best;
restart();
