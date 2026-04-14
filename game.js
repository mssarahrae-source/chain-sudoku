'use strict';

const CELL_SIZE = 72;  // fixed px-per-cell; board grows with N
const CHAIN_COLORS = [
  '#e05252', // red
  '#e07c3c', // orange
  '#2aa84a', // green
  '#3a7fd4', // blue
  '#9b4ec4', // purple
  '#c4a020', // amber
  '#c44e8c', // pink
];

/* ═══════════════════════════════════════════════════════════════
   game.js  –  Chain Sudoku  –  SVG renderer & interaction layer
   Depends on generator.js being loaded first.
═══════════════════════════════════════════════════════════════ */

/* ─── State ──────────────────────────────────────────────────────────────── */
const STATE = {
  N:          4,
  chains:     null,
  solution:   null,
  givens:     null,
  cellChain:  null,
  userGrid:   null,   // flat array N², user-entered values (0 = empty)
  selected:   -1,     // cell index, -1 = none
  history:    [],     // [{idx, prev}] for undo
  colorChains: false,  // toggle chain colour mode
  notesMode:   false,  // pencil-in candidate numbers
  notes:       null,   // Array<Set<number>>, one per cell
  darkMode:    false,  // dark background theme
  celebrationTimers: [],  // track win-animation timeouts
  soundEnabled: true,
};

/* ─── Sound system ─────────────────────────────────────────────────────────── */
const SOUNDS = (() => {
  let _ctx = null;
  function getCtx() {
    if (!_ctx) {
      try { _ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
    }
    return _ctx;
  }
  function beep(freq, dur, type, vol) {
    if (!STATE.soundEnabled) return;
    type = type || 'sine'; vol = vol || 0.3;
    try {
      const ac = getCtx(); if (!ac) return;
      const o = ac.createOscillator(), g = ac.createGain();
      o.connect(g); g.connect(ac.destination);
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(vol, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
      o.start(ac.currentTime); o.stop(ac.currentTime + dur);
    } catch(e) {}
  }
  return {
    enter: ()  => beep(523, 0.12),
    clear: ()  => beep(330, 0.10, 'sine', 0.15),
    error: ()  => beep(180, 0.25, 'square', 0.18),
    hint:  ()  => beep(440, 0.18, 'sine', 0.20),
    undo:  ()  => beep(392, 0.10, 'sine', 0.15),
    win:   ()  => {
      beep(523, 0.10);
      setTimeout(() => beep(659, 0.10), 130);
      setTimeout(() => beep(784, 0.15), 280);
      setTimeout(() => beep(1047, 0.40), 450);
    },
  };
})();

/* ─── DOM refs ───────────────────────────────────────────────────────────── */
const $svg        = document.getElementById('board');
const $status     = document.getElementById('status-msg');
const $winOverlay = document.getElementById('win-overlay');
const $genOverlay  = document.getElementById('gen-overlay');
const $rulesOverlay = document.getElementById('rules-overlay');
const $sizeSelect = document.getElementById('size-select');
const $diffSelect = document.getElementById('diff-select');

/* ─── SVG namespace helper ───────────────────────────────────────────────── */
const SVG_NS = 'http://www.w3.org/2000/svg';
function el(tag, attrs) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

/* ─── Geometry ───────────────────────────────────────────────────────────── */
// All coordinates live in a 100×100 viewBox so the board scales to any size.
function geom(idx, N) {
  const step = CELL_SIZE;  // fixed size – board grows, circles stay same
  return {
    cx: (idx % N + 0.5) * step,
    cy: (Math.floor(idx / N) + 0.5) * step,
    r:  step * 0.38,
    fs: step * 0.42,  // font-size (≈ 1.1 × r)
  };
}

/* ─── Build SVG board ────────────────────────────────────────────────────── */
function buildBoard() {
  const { N, chains, givens } = STATE;
  $svg.innerHTML = '';
  const boardSize = N * CELL_SIZE;
  $svg.setAttribute('viewBox', `0 0 ${boardSize} ${boardSize}`);
  $svg.setAttribute('width',   boardSize);
  $svg.setAttribute('height',  boardSize);

  /* 1 ── chain connector lines (drawn first; circles sit on top) ── */
  const gLines = el('g', { class: 'lines' });
  for (let ci = 0; ci < chains.length; ci++) {
    const chain = chains[ci];
    const chainColor = STATE.colorChains ? CHAIN_COLORS[ci % CHAIN_COLORS.length] : null;
    for (let i = 0; i < chain.length - 1; i++) {
      const a = geom(chain[i],     N);
      const b = geom(chain[i + 1], N);
      const attrs = { x1: a.cx, y1: a.cy, x2: b.cx, y2: b.cy, class: 'chain-line' };
      if (chainColor) attrs.style = `stroke: ${chainColor}`;  // inline style beats CSS class
      gLines.appendChild(el('line', attrs));
    }
  }
  $svg.appendChild(gLines);

  /* 2 ── circles + text ── */
  const gCells = el('g', { class: 'circles' });
  for (let idx = 0; idx < N * N; idx++) {
    const { cx, cy, r, fs } = geom(idx, N);
    const isGiven = givens[idx] !== 0;

    const chainColor = STATE.colorChains ? CHAIN_COLORS[STATE.cellChain[idx] % CHAIN_COLORS.length] : null;
    const circAttrs = {
      cx, cy, r,
      class: 'cell-circle' + (isGiven ? ' given' : ''),
      'data-idx': idx,
    };
    if (chainColor) circAttrs.style = `stroke: ${chainColor}`;  // inline style beats CSS class
    const circle = el('circle', circAttrs);
    if (!isGiven) circle.addEventListener('click', () => selectCell(idx));
    gCells.appendChild(circle);

    const txt = el('text', {
      x: cx, y: cy,
      class: 'cell-text' + (isGiven ? ' given-text' : ''),
      'font-size': fs,
      'data-txt': idx,
    });
    txt.textContent = isGiven ? givens[idx] : '';
    gCells.appendChild(txt);
  }
  $svg.appendChild(gCells);
}

/* ─── Cell selection ─────────────────────────────────────────────────────── */
function selectCell(idx) {
  // Allow navigation to given cells (typing is blocked in enterValue)
  deselect();
  STATE.selected = idx;
  circleEl(idx).classList.add('selected');
  $status.textContent = '';
}

function deselect() {
  if (STATE.selected !== -1) {
    circleEl(STATE.selected).classList.remove('selected');
    STATE.selected = -1;
  }
}

function circleEl(idx)   { return $svg.querySelector(`[data-idx="${idx}"]`); }
function textEl(idx)     { return $svg.querySelector(`[data-txt="${idx}"]`); }

/* ─── Check if a value conflicts in row/col/chain for a cell ─────────── */
function isConflicting(idx, v) {
  const { N, chains, cellChain, givens, userGrid } = STATE;
  const r = Math.floor(idx / N), c = idx % N;
  const combined = userGrid.map((val, i) => val || givens[i]);

  // Check row
  for (let cc = 0; cc < N; cc++) {
    if (cc !== c && combined[r * N + cc] === v) return true;
  }
  // Check column
  for (let rr = 0; rr < N; rr++) {
    if (rr !== r && combined[rr * N + c] === v) return true;
  }
  // Check chain
  for (const peer of chains[cellChain[idx]]) {
    if (peer !== idx && combined[peer] === v) return true;
  }
  return false;
}

/* ─── Enter / clear value ────────────────────────────────────────────────── */
function enterValue(v) {
  resetHint();
  const { selected, givens } = STATE;
  if (selected === -1) { $status.textContent = 'Select a cell first.'; return; }
  if (givens[selected] !== 0) return;   // can't overwrite a clue

  if (STATE.notesMode) {
    // Notes mode: toggle candidate, or backspace clears all notes
    // Block adding a number that already conflicts in row/col/chain
    if (v > 0 && !STATE.notes[selected].has(v) && isConflicting(selected, v)) {
      $status.textContent = `${v} already exists in this row, column, or chain.`;
      return;
    }
    $status.textContent = '';
    STATE.history.push({ idx: selected, prev: STATE.userGrid[selected], prevNotes: new Set(STATE.notes[selected]) });
    if (v > 0) {
      if (STATE.notes[selected].has(v)) STATE.notes[selected].delete(v);
      else STATE.notes[selected].add(v);
    } else {
      STATE.notes[selected].clear();
    }
    renderNotes(selected);
    return;
  }

  // Normal mode
  STATE.history.push({ idx: selected, prev: STATE.userGrid[selected], prevNotes: new Set(STATE.notes[selected]) });
  STATE.userGrid[selected] = v;

  const txt = textEl(selected);
  if (txt) txt.textContent = v > 0 ? v : '';

  // Entering a value clears notes for this cell
  STATE.notes[selected].clear();
  renderNotes(selected);

  // Auto-remove this number from notes in same row, column, and chain
  if (v > 0) {
    const N = STATE.N;
    const row = Math.floor(selected / N);
    const col = selected % N;
    const chainIdx = STATE.cellChain[selected];
    for (let i = 0; i < N * N; i++) {
      if (i === selected) continue;
      const r = Math.floor(i / N);
      const c = i % N;
      const sameRow = r === row;
      const sameCol = c === col;
      const sameChain = STATE.cellChain[i] === chainIdx;
      if (sameRow || sameCol || sameChain) {
        if (STATE.notes[i].has(v)) {
          STATE.notes[i].delete(v);
          renderNotes(i);
        }
      }
    }
  }

  // Check for conflict and blink if wrong
  const combined = STATE.userGrid.map((val, i) => val || STATE.givens[i]);
  if (v > 0 && findConflicts(combined).has(selected)) {
    blinkCell(selected);
  } else if (v > 0) {
    SOUNDS.enter();
  } else {
    SOUNDS.clear();
  }

  // Refresh error styling
  circleEl(selected).classList.remove('error');
  validateBoard(true);

  checkWin();
}

function clearCell() { enterValue(0); }

function undoMove() {
  resetHint();
  SOUNDS.undo();
  if (!STATE.history.length) { $status.textContent = 'Nothing to undo.'; return; }
  const { idx, prev, prevNotes } = STATE.history.pop();
  STATE.userGrid[idx] = prev;
  const txt = textEl(idx);
  if (txt) txt.textContent = prev > 0 ? prev : '';
  if (prevNotes !== undefined) { STATE.notes[idx] = prevNotes; renderNotes(idx); }
  const circ = circleEl(idx);
  if (circ) circ.classList.remove('error');
  validateBoard(true);
  $status.textContent = '';
  checkWin();
}


/* ─── Blink a cell to signal an incorrect entry ──────────────────────── */
function blinkCell(idx) {
  SOUNDS.error();
  const circ = circleEl(idx);
  if (!circ) return;
  const BLINKS   = 4;    // number of on/off cycles
  const INTERVAL = 160;  // ms per half-cycle
  let count = 0;
  // Temporarily remove 'selected' so blink fill always wins visually
  const wasSelected = circ.classList.contains('selected');
  circ.classList.remove('selected');
  circ.classList.add('blink');
  const id = setInterval(() => {
    circ.classList.toggle('blink');
    count++;
    if (count >= BLINKS * 2) {
      clearInterval(id);
      circ.classList.remove('blink');
      // Restore selected highlight if it was active
      if (wasSelected) circ.classList.add('selected');
    }
  }, INTERVAL);
}
/* ─── Validation ─────────────────────────────────────────────────────────── */
function findConflicts(grid) {
  const { N, chains } = STATE;
  const bad = new Set();

  const groups = [
    ...range(N).map(r => range(N).map(c => r * N + c)),   // rows
    ...range(N).map(c => range(N).map(r => r * N + c)),   // cols
    ...chains,                                              // chains
  ];

  for (const group of groups) {
    const seen = new Map();
    for (const idx of group) {
      const v = grid[idx];
      if (!v) continue;
      if (seen.has(v)) { bad.add(idx); bad.add(seen.get(v)); }
      else seen.set(v, idx);
    }
  }
  return bad;
}

function validateBoard(silent) {
  const { N, givens, userGrid } = STATE;
  const combined = userGrid.map((v, i) => v || givens[i]);
  const bad = findConflicts(combined);

  for (let i = 0; i < N * N; i++) {
    const c = circleEl(i);
    const t = textEl(i);
    if (!c) continue;
    if (bad.has(i)) {
      c.classList.add('error');
      if (t) t.classList.add('error');
    } else {
      c.classList.remove('error');
      if (t) t.classList.remove('error');
    }
  }

  if (!silent) {
    $status.textContent = bad.size
      ? `${bad.size} conflict${bad.size > 1 ? 's' : ''} found.`
      : 'No conflicts \u2014 keep going!';
    $status.style.color = bad.size ? '#c0392b' : '#2c7a2c';
  }
}

/* ─── Check solution ─────────────────────────────────────────────────────── */
function checkSolution() {
  const { N, solution, givens, userGrid } = STATE;
  if (!solution) return;
  const combined = userGrid.map((v, i) => v || givens[i]);
  const conflicts = findConflicts(combined);

  // Wrong: filled but doesn't match solution (and not already flagged as conflict)
  const wrong = new Set();
  for (let i = 0; i < N * N; i++) {
    if (userGrid[i] && userGrid[i] !== solution[i]) wrong.add(i);
  }

  // Apply visual feedback
  for (let i = 0; i < N * N; i++) {
    const c = circleEl(i);
    const t = textEl(i);
    if (!c) continue;
    if (conflicts.has(i) || wrong.has(i)) {
      c.classList.add('error');
      if (t) t.classList.add('error');
    } else {
      c.classList.remove('error');
      if (t) t.classList.remove('error');
    }
  }

  const total = conflicts.size + wrong.size;
  if (total === 0) {
    const filled = combined.filter(Boolean).length;
    const remaining = N * N - filled;
    $status.textContent = remaining === 0
      ? '\u2714 Everything looks correct!'
      : `\u2714 No mistakes so far \u2014 ${remaining} cell${remaining > 1 ? 's' : ''} left.`;
    $status.style.color = '#2c7a2c';
    SOUNDS.enter();
  } else {
    $status.textContent = `\u274C ${total} mistake${total > 1 ? 's' : ''} found \u2014 errors highlighted in red.`;
    $status.style.color = '#c0392b';
    SOUNDS.error();
  }
}

/* ─── Win detection ──────────────────────────────────────────���───────────── */
function checkWin() {
  const { N, solution, givens, userGrid } = STATE;
  for (let i = 0; i < N * N; i++) {
    if ((userGrid[i] || givens[i]) !== solution[i]) return;
  }
  // All cells match solution!
  deselect();
  $status.textContent = '';
  celebrateWin();
}

/* ─── Print puzzle + answer key ─────────────────────────────────────────── */
function buildPrintSVG(N, chains, cellChain, givens, displayGrid, useColor) {
  const CS = CELL_SIZE;
  const boardSize = N * CS;
  const lines = [];

  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${boardSize}" height="${boardSize}" viewBox="0 0 ${boardSize} ${boardSize}">`);

  // chain connector lines
  for (let ci = 0; ci < chains.length; ci++) {
    const chain = chains[ci];
    const col = useColor ? CHAIN_COLORS[ci % CHAIN_COLORS.length] : '#222';
    for (let i = 0; i < chain.length - 1; i++) {
      const a = { cx: (chain[i]   % N + 0.5) * CS, cy: (Math.floor(chain[i]   / N) + 0.5) * CS };
      const b = { cx: (chain[i+1] % N + 0.5) * CS, cy: (Math.floor(chain[i+1] / N) + 0.5) * CS };
      lines.push(`<line x1="${a.cx}" y1="${a.cy}" x2="${b.cx}" y2="${b.cy}" stroke="${col}" stroke-width="1.5" stroke-linecap="round"/>`);
    }
  }

  // circles + numbers
  for (let idx = 0; idx < N * N; idx++) {
    const cx = (idx % N + 0.5) * CS;
    const cy = (Math.floor(idx / N) + 0.5) * CS;
    const r  = CS * 0.38;
    const fs = CS * 0.42;
    const isGiven = givens[idx] !== 0;
    const val = displayGrid[idx];
    const col = useColor ? CHAIN_COLORS[cellChain[idx] % CHAIN_COLORS.length] : '#222';
    const fill = isGiven ? '#FFE600' : '#fff';
    lines.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${col}" stroke-width="1.5"/>`);
    if (val) {
      lines.push(`<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-family="Segoe UI,Arial,sans-serif" font-weight="700" font-size="${fs}" fill="#222">${val}</text>`);
    }
  }

  lines.push('</svg>');
  return lines.join('');
}

function printPuzzle() {
  const { N, chains, cellChain, givens, solution, colorChains } = STATE;
  if (!givens || !solution) {
    $status.textContent = 'No puzzle loaded yet.';
    return;
  }

  const puzzleSVG  = buildPrintSVG(N, chains, cellChain, givens, givens, colorChains);
  const answerSVG  = buildPrintSVG(N, chains, cellChain, givens, solution, colorChains);
  const boardSize  = N * CELL_SIZE;

  const diff = document.getElementById('diff-select').value;
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Chain Sudoku – Print</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Segoe UI, Arial, sans-serif; background: #fff; color: #222; }
  @page { margin: 16mm; }
  .print-page {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 24px;
    gap: 20px;
  }
  .print-page + .print-page { page-break-before: always; }
  .board-label { font-size: 26px; font-weight: 700; letter-spacing: 0.03em; text-align: center; }
  .diff-label  { font-size: 14px; color: #555; text-align: center; }
  .svg-wrap { width: min(80vmin, 560px); }
  .svg-wrap svg { width: 100%; height: auto; display: block; }
  .no-print { text-align: center; padding: 16px; }
  @media print {
    .no-print { display: none; }
    .print-page { min-height: 0; padding: 0; justify-content: flex-start; padding-top: 16px; }
    .svg-wrap { width: min(80vw, 80vh); }
  }
</style>
</head>
<body>
<div class="no-print" style="text-align:center;padding:16px 0 8px;">
  <button onclick="window.print()" style="padding:10px 28px;font-size:16px;cursor:pointer;background:#5cb85c;color:#fff;border:none;border-radius:4px;">Print / Save as PDF</button>
</div>
<div class="print-page">
  <div class="board-label">Chain Sudoku &ndash; ${N}&times;${N}</div>
  <div class="diff-label">Difficulty: ${diff}</div>
  <div class="svg-wrap">${puzzleSVG}</div>
</div>
<div class="print-page">
  <div class="board-label">Answer Key</div>
  <div class="diff-label">Chain Sudoku &ndash; ${N}&times;${N} &bull; Difficulty: ${diff}</div>
  <div class="svg-wrap">${answerSVG}</div>
</div>
</body>
</html>`;

  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
}

/* ─── Win celebration: flash each row, column, chain in sequence ─────── */
function celebrateWin() {
  SOUNDS.win();
  const { N, chains } = STATE;
  const isDark = STATE.darkMode;

  // Rainbow colors for rows and columns; chains keep their own color
  // 2N groups total (N rows + N cols), spread evenly across rainbow hues
  const L = isDark ? 30 : 75;  // lightness %
  const S = 70;                  // saturation %
  function rainbowColor(index, total) {
    const hue = Math.round((index / total) * 360);
    return `hsl(${hue}, ${S}%, ${L}%)`;
  }

  const CHAIN_FLASH_LIGHT = ['#f5b3b3','#f5d0b3','#b3f5c4','#b3cdf5','#d4b3f5','#f5ecb3','#f5b3db'];
  const CHAIN_FLASH_DARK  = ['#5a2020','#5a3520','#1a4a2a','#1a2a5a','#3a1a5a','#4a3a10','#4a1a3a'];
  const CHAIN_FLASH = isDark ? CHAIN_FLASH_DARK : CHAIN_FLASH_LIGHT;

  // Build groups with their flash color
  const groups = [
    ...Array.from({ length: N }, (_, r) => ({
      cells: Array.from({ length: N }, (_, c) => r * N + c),
      color: rainbowColor(r, 2 * N),          // rows: hues 0..180
    })),
    ...Array.from({ length: N }, (_, c) => ({
      cells: Array.from({ length: N }, (_, r) => r * N + c),
      color: rainbowColor(N + c, 2 * N),      // cols: hues 180..360
    })),
    ...chains.map((chain, ci) => ({
      cells: chain,
      color: CHAIN_FLASH[ci % CHAIN_FLASH.length],  // chains keep their own pastel
    })),
  ];

  const FLASH_MS  = 220;
  const GAP_MS    = 80;
  const STEP_MS   = FLASH_MS + GAP_MS;
  const AFTER_MS  = 400;

  // Clear any previous celebration timers
  STATE.celebrationTimers.forEach(t => clearTimeout(t));
  STATE.celebrationTimers = [];

  groups.forEach(({ cells, color }, gi) => {
    STATE.celebrationTimers.push(setTimeout(() => {
      cells.forEach(idx => {
        const c = circleEl(idx);
        if (c) { c.style.fill = color; c.style.transition = 'fill 0.15s ease'; }
      });
    }, gi * STEP_MS));

    STATE.celebrationTimers.push(setTimeout(() => {
      cells.forEach(idx => {
        const c = circleEl(idx);
        if (c) { c.style.fill = ''; c.style.transition = ''; }
      });
    }, gi * STEP_MS + FLASH_MS));
  });

  const totalMs = groups.length * STEP_MS + AFTER_MS;
  STATE.celebrationTimers.push(setTimeout(() => {
    $winOverlay.classList.remove('hidden');
  }, totalMs));
}



/* ─── Notes rendering ──────────────────────────────────────────── */
function renderNotes(idx) {
  const existing = $svg.querySelector('[data-notes="' + idx + '"]');
  if (existing) existing.remove();

  const { N, notes, userGrid, givens } = STATE;
  if (!notes || !notes[idx] || notes[idx].size === 0) return;
  if (userGrid[idx] !== 0 || givens[idx] !== 0) return;  // value takes priority

  const { cx, cy, r } = geom(idx, N);
  const candidates = [...notes[idx]].sort((a, b) => a - b);
  const count      = candidates.length;
  const availWidth = r * 1.7;  // ~85% of diameter

  // Always display candidates in a single centred row across the middle
  const noteFs  = Math.min(r * 0.30, availWidth / (count * 0.68));
  const spacing = noteFs * 0.68;
  const totalW  = (count - 1) * spacing;
  const xStart  = cx - totalW / 2;

  const g = el('g', { 'data-notes': idx });
  candidates.forEach((v, i) => {
    const t = el('text', {
      x: xStart + i * spacing, y: cy,
      class: 'note-text', 'font-size': noteFs,
    });
    t.textContent = v;
    g.appendChild(t);
  });
  $svg.appendChild(g);
}

function renderAllNotes() {
  const { N, notes } = STATE;
  if (!notes) return;
  for (let i = 0; i < N * N; i++) renderNotes(i);
}

/* ─── Re-render user-entered values after a board redraw ─────────────── */
function renderUserValues() {
  const { N, userGrid } = STATE;
  for (let i = 0; i < N * N; i++) {
    if (!userGrid[i]) continue;
    const txt = textEl(i);
    if (txt) txt.textContent = userGrid[i];
  }
  renderAllNotes();
}
/* ─── Keyboard ───────────────────────────────────────────────────────────── */
document.addEventListener('keydown', e => {
  const { N, selected } = STATE;
  const v = parseInt(e.key, 10);

  if (v >= 1 && v <= N)                                   { enterValue(v); return; }
  if (['Backspace','Delete','0'].includes(e.key))          { clearCell();   return; }
  if (e.key === 'Escape')                                  { deselect();    return; }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z')           { e.preventDefault(); undoMove(); return; }
  if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey) { document.getElementById('notes-btn').click(); return; }
  if (e.key.toLowerCase() === 'h' && !e.ctrlKey && !e.metaKey) { giveHint(); return; }

  // Arrow-key navigation
  if (selected === -1) return;
  const arrows = { ArrowRight:[0,1], ArrowLeft:[0,-1], ArrowDown:[1,0], ArrowUp:[-1,0] };
  if (arrows[e.key]) {
    e.preventDefault();
    const [dr, dc] = arrows[e.key];
    const r  = Math.floor(selected / N), c  = selected % N;
    const nr = Math.max(0, Math.min(N-1, r + dr));
    const nc = Math.max(0, Math.min(N-1, c + dc));
    selectCell(nr * N + nc);
  }
});

/* ─── Start new puzzle ────────────────────────────────────────────── */
let _activeWorker = null;  // track current generation worker


function buildNumpad(N) {
  const row = document.getElementById('numpad-row');
  row.innerHTML = '';
  for (let n = 1; n <= N; n++) {
    const btn = document.createElement('button');
    btn.className = 'num-btn';
    btn.textContent = n;
    btn.setAttribute('aria-label', 'Enter ' + n);
    btn.addEventListener('click', () => { enterValue(n); });
    row.appendChild(btn);
  }
}
function applyPuzzle(N, puzzle) {
  Object.assign(STATE, {
    N,
    chains:    puzzle.chains,
    solution:  puzzle.solution,
    givens:    puzzle.givens,
    cellChain: Array.isArray(puzzle.cellChain) ? puzzle.cellChain : Array.from(puzzle.cellChain),
    userGrid:  new Array(N * N).fill(0),
    selected:  -1,
    history:   [],
    notes:     Array.from({ length: N * N }, () => new Set()),
    notesMode: false,
  });
  document.getElementById('notes-btn').classList.remove('active');
  buildBoard();
  buildNumpad(N);
}

function startNewPuzzle(N, difficulty) {
  if (difficulty === undefined) difficulty = $diffSelect ? $diffSelect.value : 'medium';

  // Cancel any ongoing celebration animation
  STATE.celebrationTimers.forEach(t => clearTimeout(t));
  STATE.celebrationTimers = [];

  $genOverlay.classList.remove('hidden');
  $winOverlay.classList.add('hidden');
  $status.textContent = '';
  $status.style.color = '';

  // Terminate any previous worker still running
  if (_activeWorker) { _activeWorker.terminate(); _activeWorker = null; }

  // Try Web Worker first (faster, non-blocking)
  // Falls back to main-thread if running via file:// (Workers blocked by browser security)
  let workerFailed = false;
  let worker;
  try {
    worker = new Worker('generator.js');
  } catch (e) {
    workerFailed = true;
  }

  if (!workerFailed && worker) {
    _activeWorker = worker;

    worker.onmessage = function(e) {
      _activeWorker = null;
      worker.terminate();
      $genOverlay.classList.add('hidden');
      if (!e.data.ok) {
        $status.textContent = 'Generation failed — please try again.';
        $status.style.color = '#c0392b';
        console.error(e.data.error);
        return;
      }
      applyPuzzle(N, e.data.puzzle);
    };

    worker.onerror = function(err) {
      // Worker failed (e.g. file:// protocol) — fall back to main thread
      _activeWorker = null;
      worker.terminate();
      console.warn('Worker unavailable, falling back to main-thread generation:', err.message);
      mainThreadGenerate(N, difficulty);
    };

    worker.postMessage({ N, difficulty });

  } else {
    // Directly use main-thread fallback
    mainThreadGenerate(N, difficulty);
  }
}

async function mainThreadGenerate(N, difficulty) {
  // Yield so the "Generating..." overlay renders first
  await new Promise(res => setTimeout(res, 50));

  // Each call to tryGeneratePuzzle is bounded (node limits on solver).
  // Yield 0ms between attempts so the browser stays responsive.
  const MAX_TRIES = 500;
  for (let i = 0; i < MAX_TRIES; i++) {
    const puzzle = tryGeneratePuzzle(N, difficulty);
    if (puzzle) {
      $genOverlay.classList.add('hidden');
      applyPuzzle(N, puzzle);
      return;
    }
    // Yield to browser every few attempts to prevent UI freeze
    if (i % 3 === 2) await new Promise(res => setTimeout(res, 0));
  }

  $genOverlay.classList.add('hidden');
  $status.textContent = 'Generation failed — please try again.';
  $status.style.color = '#c0392b';
}


/* ─── Hint system (two-level) ────────────────────────────────────────────────────── */
const HINT_STATE = { level: 0, cellIdx: -1, value: 0, explanation: '' };

function resetHint() {
  if (HINT_STATE.cellIdx >= 0) {
    const circ = circleEl(HINT_STATE.cellIdx);
    if (circ) circ.classList.remove('hint-highlight');
    const txt = textEl(HINT_STATE.cellIdx);
    if (txt) {
      txt.textContent = STATE.userGrid[HINT_STATE.cellIdx] > 0 ? STATE.userGrid[HINT_STATE.cellIdx] : '';
      txt.classList.remove('hint-text');
    }
  }
  HINT_STATE.level = 0;
  HINT_STATE.cellIdx = -1;
  HINT_STATE.value = 0;
  HINT_STATE.explanation = '';
  const btn = document.getElementById('hint-btn');
  if (btn) btn.textContent = '\uD83D\uDCA1 Hint';
}

function giveHint() {
  const { N, chains, givens, userGrid, cellChain } = STATE;
  if (!givens) return;

  // Level 1 → 2: reveal full explanation for the already-highlighted cell
  if (HINT_STATE.level === 1) {
    $status.textContent = HINT_STATE.explanation;
    $status.style.color = '#2c7a2c';
    HINT_STATE.level = 2;
    const btn = document.getElementById('hint-btn');
    if (btn) btn.textContent = '\uD83D\uDCA1 Hint';
    return;
  }

  // Level 2: reset then fall through to find a new hint
  if (HINT_STATE.level === 2) resetHint();

  const total = N * N;
  const combined = userGrid.map((v, i) => v || givens[i]);

  const peers = Array.from({ length: total }, (_, idx) => {
    const r = Math.floor(idx / N), col = idx % N;
    const s = new Set();
    for (let cc = 0; cc < N; cc++) if (cc !== col) s.add(r * N + cc);
    for (let rr = 0; rr < N; rr++) if (rr !== r)   s.add(rr * N + col);
    for (const p of chains[cellChain[idx]]) if (p !== idx) s.add(p);
    return [...s];
  });

  function usedMask(idx) {
    let m = 0;
    for (const p of peers[idx]) if (combined[p]) m |= (1 << combined[p]);
    return m;
  }

  // Naked single: only one candidate remains
  for (let i = 0; i < total; i++) {
    if (combined[i]) continue;
    const used = usedMask(i);
    const cands = [];
    for (let v = 1; v <= N; v++) if (!(used & (1 << v))) cands.push(v);
    if (cands.length === 1) {
      const r = Math.floor(i / N) + 1, c = (i % N) + 1;
      const usedVals = [];
      for (let v = 1; v <= N; v++) if (used & (1 << v)) usedVals.push(v);
      const expl = `\uD83D\uDCA1 Row ${r}, Col ${c} must be ${cands[0]} \u2014 all other values (${usedVals.join(', ')}) are already used in its row, column, or chain.`;
      startHintLevel1(i, cands[0], `\uD83D\uDCA1 A deduction is possible in Row ${r}, Col ${c} \u2014 press Explain for the full explanation.`, expl);
      return;
    }
  }

  // Hidden single: only one cell in a group can hold value v
  const groups = [
    ...Array.from({length:N},(_,r)=>({cells:Array.from({length:N},(_,c)=>r*N+c), name:`Row ${r+1}`})),
    ...Array.from({length:N},(_,c)=>({cells:Array.from({length:N},(_,r)=>r*N+c), name:`Column ${c+1}`})),
    ...chains.map((ch,ci)=>({cells:ch, name:`Chain ${ci+1}`})),
  ];
  for (const {cells, name} of groups) {
    for (let v = 1; v <= N; v++) {
      const possible = cells.filter(i => !combined[i] && !(usedMask(i) & (1 << v)));
      if (possible.length === 1) {
        const i = possible[0];
        const r = Math.floor(i / N) + 1, c = (i % N) + 1;
        const expl = `\uD83D\uDCA1 Row ${r}, Col ${c} must be ${v} \u2014 it\'s the only cell in ${name} where ${v} can go.`;
        startHintLevel1(i, v, `\uD83D\uDCA1 A deduction is possible in Row ${r}, Col ${c} \u2014 press Explain for the full explanation.`, expl);
        return;
      }
    }
  }

  $status.textContent = 'No simple deduction found \u2014 try notes mode!';
  $status.style.color = '#888';
}

function startHintLevel1(cellIdx, val, briefMsg, fullExplanation) {
  resetHint();
  SOUNDS.hint();
  HINT_STATE.level = 1;
  HINT_STATE.cellIdx = cellIdx;
  HINT_STATE.value = val;
  HINT_STATE.explanation = fullExplanation;
  selectCell(cellIdx);
  const circ = circleEl(cellIdx);
  if (circ) circ.classList.add('hint-highlight');
  $status.textContent = briefMsg;
  $status.style.color = '#2c7a2c';
  const btn = document.getElementById('hint-btn');
  if (btn) btn.textContent = '\uD83D\uDCA1 Explain';
}

/* ─── Shareable puzzle codes ────────────────────────────────────────────────── */
function encodePuzzle() {
  const { N, chains, givens } = STATE;
  if (!givens) return null;
  try {
    return btoa(unescape(encodeURIComponent(
      JSON.stringify({ N, chains, givens: Array.from(givens) })
    )));
  } catch(e) { return null; }
}

function sharePuzzle() {
  const code = encodePuzzle();
  if (!code) { $status.textContent = 'No puzzle to share.'; return; }
  const url = location.href.split('#')[0] + '#p=' + code;
  function fallback() {
    try {
      const el = document.createElement('input');
      el.value = url; document.body.appendChild(el);
      el.select(); document.execCommand('copy');
      document.body.removeChild(el);
    } catch(e) {}
    $status.textContent = 'Link copied to clipboard!';
    $status.style.color = '#2c7a2c';
  }
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => {
      $status.textContent = 'Link copied to clipboard!';
      $status.style.color = '#2c7a2c';
    }).catch(fallback);
  } else { fallback(); }
}

function loadFromHash() {
  const hash = location.hash;
  if (!hash.startsWith('#p=')) return false;
  try {
    const obj = JSON.parse(decodeURIComponent(escape(atob(hash.slice(3)))));
    const { N, chains, givens } = obj;
    if (!N || !chains || !givens) return false;
    const res = solvePuzzle(N, chains, givens, 1, false, 60000);
    if (!res.count) { console.warn('Shared puzzle has no solution'); return false; }
    const cellChain = new Uint8Array(N * N);
    for (let c = 0; c < N; c++) for (const idx of chains[c]) cellChain[idx] = c;
    applyPuzzle(N, { chains, solution: res.solutions[0], givens, cellChain });
    history.replaceState(null, '', location.href.split('#')[0]);
    $status.textContent = 'Shared puzzle loaded!';
    $status.style.color = '#2c7a2c';
    return true;
  } catch(e) { console.warn('Could not load shared puzzle:', e); return false; }
}

/* ─── Button wiring ──────────────────────────────────────────────────────── */
document.getElementById('new-puzzle-btn').addEventListener('click', () => {
  resetHint();
  startNewPuzzle(parseInt($sizeSelect.value, 10), $diffSelect.value);
});

document.getElementById('play-again-btn').addEventListener('click', () => {
  $winOverlay.classList.add('hidden');
  resetHint();
  startNewPuzzle(STATE.N, $diffSelect.value);
});

document.getElementById('check-btn').addEventListener('click', checkSolution);
document.getElementById('clear-btn').addEventListener('click', clearCell);
document.getElementById('undo-btn').addEventListener('click', undoMove);

document.getElementById('notes-btn').addEventListener('click', () => {
  STATE.notesMode = !STATE.notesMode;
  document.getElementById('notes-btn').classList.toggle('active', STATE.notesMode);
  $status.textContent = STATE.notesMode ? 'Notes mode — type to add or remove candidates.' : '';
});

document.getElementById('dark-mode-btn').addEventListener('click', () => {
  STATE.darkMode = !STATE.darkMode;
  document.body.classList.toggle('dark-mode', STATE.darkMode);
  document.getElementById('dark-mode-btn').classList.toggle('active', STATE.darkMode);
  // Rebuild board so SVG colours update via CSS
  buildBoard();
  renderUserValues();
  validateBoard(true);
});

document.getElementById('help-btn').addEventListener('click', () =>
  $rulesOverlay.classList.remove('hidden'));

document.getElementById('close-rules-btn').addEventListener('click', () =>
  $rulesOverlay.classList.add('hidden'));

// Close rules overlay when clicking the dark backdrop
$rulesOverlay.addEventListener('click', e => {
  if (e.target === $rulesOverlay) $rulesOverlay.classList.add('hidden');
});

document.getElementById('color-chains-btn').addEventListener('click', () => {
  STATE.colorChains = !STATE.colorChains;
  document.getElementById('color-chains-btn').classList.toggle('active', STATE.colorChains);
  buildBoard();
  renderUserValues();
  validateBoard(true);
});

document.getElementById('print-btn').addEventListener('click', printPuzzle);

document.getElementById('hint-btn').addEventListener('click', giveHint);
document.getElementById('share-btn').addEventListener('click', sharePuzzle);
document.getElementById('sound-btn').addEventListener('click', () => {
  STATE.soundEnabled = !STATE.soundEnabled;
  const btn = document.getElementById('sound-btn');
  btn.textContent = STATE.soundEnabled ? '\uD83D\uDD0A Sound ON' : '\uD83D\uDD07 Sound OFF';
});





/* ─── Bootstrap ──────────────────────────────────────────────────────────── */
if (!loadFromHash()) startNewPuzzle(4, 'medium');
