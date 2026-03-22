'use strict';

/* ─── utils ────────────────────────────────────────────────────────────── */

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function range(n) {
  return Array.from({ length: n }, (_, i) => i);
}

/** 8-connected neighbours of cell index in an N*N grid */
function nbrs8(idx, N) {
  const r = Math.floor(idx / N), c = idx % N, out = [];
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < N && nc >= 0 && nc < N) out.push(nr * N + nc);
    }
  return out;
}

/* ─── chain generation ──────────────────────────────────────────────────── */

/**
 * Partition an N*N grid into N chains, each an ordered path of N cells
 * (8-connected adjacency between consecutive elements).
 * Returns: array of N arrays, each containing N cell indices in path order.
 */
function generateChains(N) {
  const total = N * N;
  const MAX_TRIES = 10000;

  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const owner = new Int8Array(total).fill(-1);
    const chains = [];
    let ok = true;

    const starts = shuffle(range(total));
    let si = 0;

    for (let c = 0; c < N && ok; c++) {
      /* advance to next unassigned start cell */
      while (si < total && owner[starts[si]] !== -1) si++;
      if (si >= total) { ok = false; break; }

      const chain = [starts[si++]];
      owner[chain[0]] = c;

      while (chain.length < N) {
        const bN = nbrs8(chain[chain.length - 1], N).filter(i => owner[i] === -1);
        const fN = nbrs8(chain[0],                N).filter(i => owner[i] === -1);

        if (!bN.length && !fN.length) { ok = false; break; }

        /* extend from the end with more options (ties go to back) */
        let addBack;
        if      (!bN.length) addBack = false;
        else if (!fN.length) addBack = true;
        else                 addBack = bN.length >= fN.length;

        const pool = addBack ? bN : fN;
        const next = pool[Math.floor(Math.random() * pool.length)];
        if (addBack) chain.push(next); else chain.unshift(next);
        owner[next] = c;
      }

      if (ok) chains.push(chain);
    }

    if (ok && chains.length === N && owner.every(v => v >= 0)) return chains;
  }

  throw new Error('generateChains: gave up after ' + MAX_TRIES + ' tries (N=' + N + ')');
}

/* ─── solver ────────────────────────────────────────────────────────────── */

/**
 * Backtracking solver for Chain Sudoku.
 * @param {number}     N          grid size
 * @param {number[][]} chains     N chains of N cell indices each
 * @param {number[]}   grid       flat N^2 array, 0=empty, 1..N filled
 * @param {number}     maxSols    stop after this many solutions (default 1)
 * @param {boolean}    randVals   shuffle value order for variety (default false)
 * @returns {{ solutions: number[][], count: number }}
 */
function solvePuzzle(N, chains, grid, maxSols, randVals, maxNodes) {
  if (maxSols  === undefined) maxSols  = 1;
  if (randVals === undefined) randVals = false;
  if (maxNodes === undefined) maxNodes = Infinity;

  const total = N * N;
  const work  = grid.slice();

  /* cell -> chain index */
  const cellChain = new Uint8Array(total);
  for (let c = 0; c < N; c++)
    for (const idx of chains[c]) cellChain[idx] = c;

  /* precompute peer list for every cell (row + col + chain, excluding self) */
  const peers = Array.from({ length: total }, (_, idx) => {
    const r = Math.floor(idx / N), col = idx % N;
    const s = new Set();
    for (let cc = 0; cc < N; cc++) if (cc !== col) s.add(r * N + cc);
    for (let rr = 0; rr < N; rr++) if (rr !== r)   s.add(rr * N + col);
    for (const p of chains[cellChain[idx]]) if (p !== idx) s.add(p);
    return [...s];
  });

  const ordered = range(N).map(i => i + 1);
  const sols    = [];
  let   nodes   = 0;
  let   hitLimit = false;

  function bt() {
    if (sols.length >= maxSols || hitLimit) return;

    /* MRV: pick the empty cell with the fewest legal values */
    let bestPos = -1, bestCount = N + 1, bestUsed = 0;
    for (let i = 0; i < total; i++) {
      if (work[i]) continue;
      let used = 0;
      for (const p of peers[i]) if (work[p]) used |= (1 << work[p]);
      let cnt = 0;
      for (let v = 1; v <= N; v++) if (!(used & (1 << v))) cnt++;
      if (cnt === 0) return;          /* dead end – backtrack immediately */
      if (cnt < bestCount) { bestCount = cnt; bestPos = i; bestUsed = used; }
    }

    if (bestPos === -1) { sols.push(work.slice()); return; } /* all filled */

    const vals = randVals ? shuffle(range(N).map(i => i + 1)) : ordered;
    for (const v of vals) {
      if (!(bestUsed & (1 << v))) {
        if (++nodes > maxNodes) { hitLimit = true; return; }
        work[bestPos] = v;
        bt();
        work[bestPos] = 0;
        if (sols.length >= maxSols || hitLimit) return;
      }
    }
  }

  bt();
  return { solutions: sols, count: sols.length, limitHit: hitLimit };
}

/* ─── puzzle generation ──────────────────────────────────────────────────── */

/**
 * Single attempt at generating a puzzle. Returns null if any step fails.
 */
function tryGeneratePuzzle(N, difficulty) {
  /* 1 - generate chains */
  let chains;
  try { chains = generateChains(N); }
  catch (_) { return null; }

  /* 2 - find a complete solution with node limit to prevent infinite loops */
  const empty = new Array(N * N).fill(0);
  const res   = solvePuzzle(N, chains, empty, 1, true, 30000);
  if (!res.count || res.limitHit) return null;
  const solution = res.solutions[0];

  /* 3 - remove cells according to difficulty while keeping solution unique */
  const total    = N * N;
  const maxEmpty = difficulty === 'easy'   ? Math.floor(total * 0.35) :
                   difficulty === 'medium' ? Math.floor(total * 0.50) :
                   Math.floor(total * 0.65);  // hard: up to 65%
  const givens = solution.slice();
  let removed  = 0;
  for (const idx of shuffle(range(N * N))) {
    if (removed >= maxEmpty) break;
    const saved = givens[idx];
    givens[idx]  = 0;
    // Low node limit per check keeps each check fast
    const check = solvePuzzle(N, chains, givens, 2, false, 8000);
    if (check.count !== 1) givens[idx] = saved;
    else removed++;
  }

  /* 4 - build cell->chain map */
  const cellChain = new Uint8Array(N * N);
  for (let c = 0; c < N; c++)
    for (const idx of chains[c]) cellChain[idx] = c;

  return { N, chains, solution, givens, cellChain };
}

/**
 * Generate a puzzle, retrying synchronously until success (for Worker use).
 */
function generatePuzzle(N, difficulty) {
  if (difficulty === undefined) difficulty = 'medium';
  const MAX_TRIES = 500;
  for (let i = 0; i < MAX_TRIES; i++) {
    const p = tryGeneratePuzzle(N, difficulty);
    if (p) return p;
  }
  throw new Error('generatePuzzle: gave up after ' + MAX_TRIES + ' tries (N=' + N + ')');
}


/* ─── Web Worker interface ──────────────────────────────────────────────── */
/* When loaded as a Worker (no window object), listen for generation requests */
if (typeof window === 'undefined') {
  self.onmessage = function(e) {
    const { N, difficulty } = e.data;
    try {
      const puzzle = generatePuzzle(N, difficulty);
      // Convert Uint8Array to plain Array so it survives structured clone
      puzzle.cellChain = Array.from(puzzle.cellChain);
      self.postMessage({ ok: true, puzzle });
    } catch (err) {
      self.postMessage({ ok: false, error: err.message });
    }
  };
}
