/* Fred's front page: draws the scenery and walks the trail.
   Everything here is decoration; the page reads the same without it. */
(() => {
  'use strict';
  const SVG = 'http://www.w3.org/2000/svg';
  const root = document.documentElement;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** A small seeded random, so the scenery is the same on every visit. */
  const seeded = (seed) => () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const el = (name, attrs) => {
    const e = document.createElementNS(SVG, name);
    // Styles go through the style object, not a style attribute: the CSP (vercel.json) blocks those.
    for (const k in attrs) { if (k === 'style') e.style.cssText = attrs[k]; else e.setAttribute(k, attrs[k]); }
    return e;
  };
  const f1 = (n) => Math.round(n * 10) / 10;

  /* ─────────── hills and pines, after the app's horizon (scene.tsx) ─────────── */

  /** A pine like the one in the logo's d: three tiers on a short trunk. */
  function pine(cx, base, h) {
    const w = h * 0.62;
    const pts = [[0, 1], [0.30, 0.64], [0.16, 0.64], [0.42, 0.35], [0.26, 0.35], [0.5, 0.07], [0.08, 0.07], [0.08, -0.06]];
    const right = pts.map(([u, v]) => [cx + u * w, base - v * h]);
    const left = pts.slice(1).reverse().map(([u, v]) => [cx - u * w, base - v * h]);
    return 'M' + right.concat(left).map(([x, y]) => f1(x) + ' ' + f1(y)).join('L') + 'Z';
  }

  const SCENES = {
    morning: { w: 2400, h: 420, layers: [
      { base: 150, amp: 46, fill: 'var(--h-back)', tree: 'var(--t-back)', trees: 30, size: [20, 34] },
      { base: 230, amp: 38, fill: 'var(--h-mid)', tree: 'var(--t-mid)', trees: 20, size: [32, 52] },
      { base: 318, amp: 26, fill: 'var(--h-front)', tree: 'var(--t-front)', trees: 11, size: [48, 76] },
      { base: 392, amp: 8, fill: 'var(--cream)', trees: 0 },
    ] },
    mini: { w: 600, h: 120, layers: [
      { base: 60, amp: 14, fill: '#C3DDBC', tree: '#8FBF8A', trees: 12, size: [9, 14] },
      { base: 92, amp: 10, fill: '#A4CE9C', tree: '#6AA46B', trees: 7, size: [13, 20] },
      { base: 116, amp: 3, fill: '#FBF4E4', trees: 0 },
    ] },
    sunset: { w: 2400, h: 460, layers: [
      { base: 170, amp: 50, fill: 'var(--ss-back)', tree: 'var(--ss-mid)', trees: 26, size: [22, 36] },
      { base: 270, amp: 40, fill: 'var(--ss-mid)', tree: 'var(--ss-tree)', trees: 16, size: [36, 56] },
      { base: 372, amp: 30, fill: 'var(--ss-front)', tree: 'var(--ss-tree)', trees: 10, size: [56, 84] },
    ] },
    night: { w: 2400, h: 340, layers: [
      { base: 120, amp: 40, fill: 'var(--n-h-back)', tree: 'var(--n-h-mid)', trees: 26, size: [20, 32] },
      { base: 200, amp: 32, fill: 'var(--n-h-mid)', tree: 'var(--n-tree)', trees: 16, size: [32, 50] },
      { base: 282, amp: 22, fill: 'var(--n-h-front)', tree: 'var(--n-tree)', trees: 9, size: [46, 70] },
      { base: 330, amp: 6, fill: 'var(--n-ground)', trees: 0 },
    ] },
  };

  function drawHills(svg) {
    const kind = svg.dataset.hills;
    const scene = SCENES[kind];
    if (!scene) return;
    const rand = seeded(Number(svg.dataset.seed || kind.length * 97));
    const { w, h } = scene;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMax slice');
    for (const L of scene.layers) {
      const p = [rand() * 6, rand() * 6, rand() * 6];
      const span = w / (1.6 + rand() * 0.8);
      const y = (x) => L.base + L.amp * (
        0.58 * Math.sin((x / span) * Math.PI * 2 + p[0]) +
        0.28 * Math.sin((x / span) * Math.PI * 4.3 + p[1]) +
        0.14 * Math.sin((x / span) * Math.PI * 9.1 + p[2]));
      let d = `M0 ${h + 2}`;
      for (let x = 0; x <= w; x += w / 120) d += `L${f1(x)} ${f1(y(x))}`;
      d += `L${w} ${h + 2}Z`;
      const g = el('g', {});
      g.appendChild(el('path', { d, style: `fill:${L.fill}` }));
      if (L.trees) {
        let t = '';
        for (let i = 0; i < L.trees; i++) {
          // Loosely clumped: trees come in twos and threes, as they do on a ridge.
          const x = ((i + rand() * 0.9) / L.trees) * w;
          const size = L.size[0] + rand() * (L.size[1] - L.size[0]);
          t += pine(x, y(x) + size * 0.12, size);
          if (rand() < 0.45) { const s2 = size * (0.6 + rand() * 0.25); const x2 = x + size * (0.45 + rand() * 0.3); t += pine(x2, y(x2) + s2 * 0.12, s2); }
        }
        g.appendChild(el('path', { d: t, style: `fill:${L.tree};stroke:${L.tree};stroke-width:${f1(L.size[0] * 0.06)};stroke-linejoin:round` }));
      }
      svg.appendChild(g);
    }
  }

  /* ─────────── stars ─────────── */
  function drawStars(box) {
    const n = Number(box.dataset.stars) || 60;
    const rand = seeded(n * 13);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < n; i++) {
      const s = document.createElement('i');
      const size = 1 + rand() * rand() * 2.4;
      s.style.cssText = `left:${(rand() * 100).toFixed(2)}%;top:${(rand() * rand() * 70).toFixed(2)}%;width:${size.toFixed(1)}px;height:${size.toFixed(1)}px;opacity:${(0.35 + rand() * 0.65).toFixed(2)}`;
      frag.appendChild(s);
    }
    box.appendChild(frag);
  }

  /* ─────────── contour lines: after Fred James's maps ─────────── */
  function noise2(seed) {
    const rand = seeded(seed);
    const perm = new Uint8Array(512), vals = new Float32Array(256);
    for (let i = 0; i < 256; i++) { perm[i] = i; vals[i] = rand(); }
    for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
    for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
    const v = (x, y) => vals[perm[(x & 255) + perm[y & 255]]];
    const s = (t) => t * t * (3 - 2 * t);
    return (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = s(x - xi), yf = s(y - yi);
      const a = v(xi, yi), b = v(xi + 1, yi), c = v(xi, yi + 1), d = v(xi + 1, yi + 1);
      return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
    };
  }

  function drawContours(g) {
    const kind = g.dataset.contours;
    const seed = Number(g.dataset.seed) || 7;
    const W = Number(g.dataset.w) || 1400, H = Number(g.dataset.h) || 1000;
    const cell = kind === 'map' ? 6 : 10;
    const scale = kind === 'map' ? 1 / 120 : 1 / 260;
    const n = noise2(seed);
    const svg = g.ownerSVGElement;
    if (kind !== 'map') svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    // Two summits, so the lines ring them the way a quad map rings a peak.
    const peaks = kind === 'map' ? [[0.62, 0.3, 0.9], [0.2, 0.75, 0.6]] : [[0.72, 0.36, 1.0], [0.18, 0.2, 0.55]];
    const field = (x, y) => {
      let v = 0.55 * n(x * scale, y * scale) + 0.28 * n(x * scale * 2.1, y * scale * 2.1) + 0.12 * n(x * scale * 4.3, y * scale * 4.3);
      for (const [px, py, k] of peaks) {
        const dx = x / W - px, dy = (y / H - py) * (H / W);
        v += k * Math.exp(-(dx * dx + dy * dy) / 0.045);
      }
      return v;
    };
    const cols = Math.ceil(W / cell) + 1, rows = Math.ceil(H / cell) + 1;
    const grid = new Float32Array(cols * rows);
    let lo = Infinity, hi = -Infinity;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const v = field(i * cell, j * cell); grid[j * cols + i] = v;
      if (v < lo) lo = v; if (v > hi) hi = v;
    }
    const levels = kind === 'map' ? 16 : 22;
    const segsFor = (t) => {
      let d = '';
      const lerp = (a, b) => (t - a) / (b - a);
      for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
        const a = grid[j * cols + i], b = grid[j * cols + i + 1], c = grid[(j + 1) * cols + i + 1], e = grid[(j + 1) * cols + i];
        const k = (a > t ? 8 : 0) | (b > t ? 4 : 0) | (c > t ? 2 : 0) | (e > t ? 1 : 0);
        if (k === 0 || k === 15) continue;
        const x = i * cell, y = j * cell;
        const T = [x + cell * lerp(a, b), y], R = [x + cell, y + cell * lerp(b, c)];
        const B = [x + cell * lerp(e, c), y + cell], Lf = [x, y + cell * lerp(a, e)];
        const seg = (p, q) => { d += `M${f1(p[0])} ${f1(p[1])}L${f1(q[0])} ${f1(q[1])}`; };
        switch (k) {
          case 1: case 14: seg(Lf, B); break;
          case 2: case 13: seg(B, R); break;
          case 3: case 12: seg(Lf, R); break;
          case 4: case 11: seg(T, R); break;
          case 5: seg(Lf, T); seg(B, R); break;
          case 6: case 9: seg(T, B); break;
          case 7: case 8: seg(Lf, T); break;
          case 10: seg(T, R); seg(Lf, B); break;
        }
      }
      return d;
    };
    for (let l = 1; l < levels; l++) {
      const d = segsFor(lo + ((hi - lo) * l) / levels);
      if (d) g.appendChild(el('path', { d, class: l % 5 === 0 ? 'index' : '', 'stroke-linecap': 'round' }));
    }
  }

  /* ─────────── the trail, and the hiker on it ─────────── */
  const trail = document.querySelector('.trail');
  const trailPath = trail.querySelector('.trail-path');
  const grad = trail.querySelector('#trail-ink');
  const hiker = trail.querySelector('.hiker');
  const posts = [...document.querySelectorAll('.post')];
  const bands = [...document.querySelectorAll('.band')];
  let samples = [];   // [{x, y}] along the trail, every few px
  let miles = [];     // [{y, mile}] at each post

  const docTop = (r) => r.top + scrollY;

  function buildTrail() {
    // Measured with the trail folded away, or its own height would hold the page open.
    trail.style.height = '0px';
    const H = document.documentElement.scrollHeight;
    trail.setAttribute('height', H);
    trail.style.height = H + 'px';
    const pts = posts.map((p) => {
      const r = p.querySelector('.dot').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: docTop(r) + r.height / 2, mile: Number(p.dataset.mile) };
    }).sort((a, b) => a.y - b.y);
    miles = pts.map((p) => ({ y: p.y, mile: p.mile }));
    // Switchbacks between posts: the path swings out into the gutter and back.
    const gutter = parseFloat(getComputedStyle(root).getPropertyValue('--gutter')) || 60;
    const amp = Math.min(gutter * 0.3, 42);
    let d = `M${f1(pts[0].x)} ${f1(pts[0].y)}`;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], dy = b.y - a.y;
      const side = i % 2 ? 1 : -1;
      const mx = (a.x + b.x) / 2 + side * amp, my = a.y + dy / 2;
      d += `C${f1(a.x)} ${f1(a.y + dy * 0.22)} ${f1(mx)} ${f1(my - dy * 0.22)} ${f1(mx)} ${f1(my)}`;
      d += `S${f1(b.x)} ${f1(b.y - dy * 0.22)} ${f1(b.x)} ${f1(b.y)}`;
    }
    trailPath.setAttribute('d', d);
    const len = trailPath.getTotalLength();
    samples = [];
    for (let l = 0; l <= len; l += 6) { const p = trailPath.getPointAtLength(l); samples.push({ x: p.x, y: p.y }); }
    paintTrail(H);
    onScroll();
  }

  function paintTrail(H) {
    grad.setAttribute('y2', H);
    grad.replaceChildren();
    for (const b of bands) {
      const r = b.getBoundingClientRect();
      const c = getComputedStyle(b).getPropertyValue('--trail-c').trim() || '#CDBB93';
      for (const y of [docTop(r) + 1, docTop(r) + r.height - 1]) grad.appendChild(el('stop', { offset: Math.max(0, Math.min(1, y / H)).toFixed(4), 'stop-color': c }));
    }
  }

  /* ─────────── the status bar ─────────── */
  const status = document.querySelector('.status');
  const bars = [...status.querySelectorAll('.status-bars i')];
  const word = status.querySelector('.status-word');
  const mileOut = status.querySelector('.status-mile b');
  const STAGES = [ // [from mile, bars, words]
    [0, 4, 'LTE'], [0.4, 3, 'LTE'], [1.2, 2, '3G'], [2.1, 1, 'E'], [3.0, -1, 'Searching…'], [3.8, 0, 'No service'],
  ];
  let lastStage = null;
  const night = document.getElementById('camp');

  function onScroll() {
    if (!samples.length) return;
    const target = scrollY + innerHeight * 0.62;
    // the hiker: the point on the trail level with that line
    let lo = 0, hi = samples.length - 1;
    if (target <= samples[0].y) hi = 0; else if (target >= samples[hi].y) lo = hi;
    else while (hi - lo > 1) { const m = (lo + hi) >> 1; if (samples[m].y < target) lo = m; else hi = m; }
    const p = samples[hi];
    hiker.setAttribute('transform', `translate(${f1(p.x)} ${f1(p.y)})`);
    hiker.style.opacity = target < samples[0].y - 40 ? 0 : 1;
    const nightNow = target > docTop(night.getBoundingClientRect());
    hiker.style.setProperty('--pine', nightNow ? 'var(--n-pine)' : '');

    // miles walked, read off the posts either side
    let mile = 0;
    for (let i = 0; i < miles.length; i++) {
      if (target >= miles[i].y) {
        const next = miles[i + 1];
        mile = next ? miles[i].mile + (next.mile - miles[i].mile) * Math.min(1, (target - miles[i].y) / (next.y - miles[i].y)) : miles[i].mile;
      }
    }
    mileOut.textContent = mile.toFixed(1);
    let stage = STAGES[0];
    for (const s of STAGES) if (mile >= s[0]) stage = s;
    if (stage !== lastStage) {
      lastStage = stage;
      bars.forEach((b, i) => b.classList.toggle('off', stage[1] >= 0 && i >= stage[1]));
      word.textContent = stage[2];
      status.classList.toggle('searching', stage[1] < 0);
    }
    status.classList.toggle('camp', scrollY + 40 > docTop(night.getBoundingClientRect()));
  }

  let frame = 0;
  addEventListener('scroll', () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; onScroll(); }); }, { passive: true });

  /* ─────────── "ends." fades once it has been read ─────────── */
  const fade = document.querySelector('.fade-word');
  if (fade && !still && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setTimeout(() => fade.classList.add('gone'), 900); io.disconnect(); }
    }, { threshold: 1 });
    io.observe(fade);
  }

  /* ─────────── go ─────────── */
  document.querySelectorAll('svg[data-hills]').forEach(drawHills);
  document.querySelectorAll('[data-stars]').forEach(drawStars);
  document.querySelectorAll('[data-contours]').forEach(drawContours);
  buildTrail();
  if (document.fonts) document.fonts.ready.then(buildTrail);
  let resizeFrame = 0;
  new ResizeObserver(() => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(buildTrail); }).observe(document.body);
})();
