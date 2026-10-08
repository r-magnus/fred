// Draws the app's small shapes (leaf, tree, the Ask arrow) and copies the logo
// into apps/mobile/assets/ui. The shapes are white on transparent so the app
// can tint them (src/calm-loader.tsx); edit the drawings here and re-run:
//
//   node scripts/build-ui-glyphs.mjs
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'apps/mobile/assets/ui');
mkdirSync(out, { recursive: true });

// Each drawing is on a 96 x 96 board and sits on the bottom edge, because the
// tree grows up from it.
const TIERS = {
  top: '<path d="M48 9 L62 30 L34 30 Z"/>',
  mid: '<path d="M48 24 L69 52 L27 52 Z"/>',
  low: '<path d="M48 42 L77 76 L19 76 Z"/>',
};
const TRUNK = '<rect x="42" y="76" width="12" height="16" rx="3"/>';
const GLYPHS = {
  // A leaf leaning to the right, with its midrib and stem.
  leaf: `
    <mask id="m">
      <rect width="96" height="96" fill="#fff"/>
      <path d="M30 78 C40 58 52 42 68 26" stroke="#000" stroke-width="3.5" stroke-linecap="round" fill="none"/>
    </mask>
    <g mask="url(#m)">
      <path d="M78 12 C84 46 70 76 34 80 C14 82 14 60 22 46 C34 24 54 14 78 12 Z"/>
    </g>
    <path d="M32 78 C28 84 24 88 18 92" stroke="#fff" stroke-width="5" stroke-linecap="round" fill="none"/>`,
  // The pine from the logo: three soft tiers and a trunk.
  tree: `<g stroke="#fff" stroke-width="7" stroke-linejoin="round">${TIERS.top}${TIERS.mid}${TIERS.low}</g>${TRUNK}`,
  // The same pine in its four pieces, each on the full board so they stack
  // in place: the loader grows the tree one piece at a time.
  'tree-top': `<g stroke="#fff" stroke-width="7" stroke-linejoin="round">${TIERS.top}</g>`,
  'tree-mid': `<g stroke="#fff" stroke-width="7" stroke-linejoin="round">${TIERS.mid}</g>`,
  'tree-low': `<g stroke="#fff" stroke-width="7" stroke-linejoin="round">${TIERS.low}</g>`,
  'tree-trunk': TRUNK,
  // The Ask button: an arrow pointing up.
  'arrow-up': '<path d="M48 76 L48 22 M24 44 L48 20 L72 44" stroke="#fff" stroke-width="11" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
};

const SIZE = 192; // Shown at up to 84 points, so sharp on a 2x screen.
for (const [name, body] of Object.entries(GLYPHS)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="#fff">${body}</svg>`;
  await sharp(Buffer.from(svg), { density: 72 * (SIZE / 96) }).resize(SIZE, SIZE).png().toFile(path.join(out, `${name}.png`));
}

// The horizon at the top of the app (src/scene.tsx): three paper-cut hills,
// each a white silhouette the app tints, drawn 1200 x 300 and shown a quarter
// of that size. A ridge is two sine waves, so a pine can be stood exactly on it.
const W = 1200, H = 300;
const ridge = (base, a, f1, p1, b, f2, p2) => (x) =>
  base + a * Math.sin((x / W) * Math.PI * 2 * f1 + p1) + b * Math.sin((x / W) * Math.PI * 2 * f2 + p2);
const pine = (x, y, h) => {
  const w = h * 0.55;
  const tier = (top, foot, half) => `M${x} ${y - h * top} L${x + w * half} ${y - h * foot} L${x - w * half} ${y - h * foot} Z`;
  return `<path d="${tier(1, 0.58, 0.5)} ${tier(0.76, 0.3, 0.72)} ${tier(0.5, -0.1, 0.95)}" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>`;
};
const hill = (y, pines) => {
  const pts = Array.from({ length: 121 }, (_, i) => `${i * 10} ${y(i * 10).toFixed(1)}`).join(' L');
  return `<path d="M${pts} L${W} ${H} L0 ${H} Z"/>${pines.map(([x, h]) => pine(x, y(x), h)).join('')}`;
};
const back = ridge(150, 22, 1.5, 0.6, 9, 4, 1.2);
const mid = ridge(208, 20, 1, 3.4, 7, 3, 0.4);
const front = ridge(262, 13, 1, 1.1, 4, 2.5, 2);
const SCENE = {
  'hill-back': [W, H, hill(back, [[150, 34], [186, 46], [222, 30], [700, 38], [735, 28], [1010, 40], [1046, 30]])],
  'hill-mid': [W, H, hill(mid, [[90, 44], [420, 52], [462, 66], [506, 46], [880, 58], [924, 42], [1130, 50]])],
  'hill-front': [W, H, hill(front, [])],
  // A bird far off: two soft wings.
  gull: [176, 96, '<path d="M6 30 C18 12 32 13 44 30 C56 13 70 12 82 30 C70 23 58 25 44 41 C30 25 18 23 6 30 Z" transform="scale(2)"/>'],
  cloud: [320, 140, '<g transform="scale(2)"><circle cx="46" cy="42" r="20"/><circle cx="80" cy="32" r="27"/><circle cx="114" cy="43" r="19"/><rect x="26" y="40" width="108" height="22" rx="11"/></g>'],
};
for (const [name, [w, h, body]] of Object.entries(SCENE)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="#fff">${body}</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path.join(out, `${name}.png`));
}
// One step of the dotted trail down the chat, repeated by the app; a file per screen density.
for (const scale of [1, 2, 3]) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${6 * scale}" height="${14 * scale}" viewBox="0 0 6 14" fill="#fff"><circle cx="3" cy="7" r="2"/></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path.join(out, `trail-dot${scale === 1 ? '' : `@${scale}x`}.png`));
}
copyFileSync(path.join(root, 'docs/assets/fred-logo.png'), path.join(out, 'fred-logo.png'));
console.log(`wrote ${[...Object.keys(GLYPHS), ...Object.keys(SCENE), 'trail-dot'].join(', ')} and the logo to ${path.relative(root, out)}`);
