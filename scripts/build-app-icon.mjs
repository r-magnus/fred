// Draws the app's home-screen icon from the logo: the wordmark in cream on the
// app's pine green, so the tree in the "d" shows green. Re-run after the logo
// or the colours change:
//
//   node scripts/build-app-icon.mjs
//
// The Android project only picks the icon up when it is regenerated
// (`npx expo prebuild --platform android` in apps/mobile). That wipes
// android/ even without --clean: afterwards put back local.properties, re-run
// the patch scripts in the root package.json's postinstall, and compare
// AndroidManifest.xml with the old one (2026-10-08: the fresh one asked for
// READ_PHONE_STATE, which the app does not need; the old manifest was kept).
//
// Writes into apps/mobile/assets, where app.json points:
//   icon.png                     the whole icon, square, no transparency (iPhone, older Android)
//   android-icon-foreground.png  the wordmark alone; Android adds the green behind it and cuts the shape
//   android-icon-monochrome.png  the same in white, for Android's themed icons
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'apps/mobile/assets');
const LOGO = path.join(root, 'docs/assets/fred-logo.png');

// The day palette's pine and cream (apps/mobile/src/theme.tsx). The green is
// also app.json's android.adaptiveIcon.backgroundColor.
const PINE = '#316C33';
const CREAM = '#FBF4E4';
const SIZE = 1024;
// Android may cut an adaptive icon to a circle 61% of the board across; the
// wordmark (900 x 415) fits inside that circle at this width with room to spare.
const ADAPTIVE_WIDTH = 540;
// The square icon is only rounded at the corners, so the wordmark can be wider.
const SQUARE_WIDTH = 760;

/** The logo's shape in one colour, centred on a transparent board. */
async function wordmark(width, colour) {
  const alpha = await sharp(LOGO).resize({ width }).ensureAlpha().extractChannel('alpha').toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = alpha.info;
  const mark = await sharp({ create: { width: w, height: h, channels: 3, background: colour } })
    .joinChannel(alpha.data).png().toBuffer();
  return { input: mark, left: Math.round((SIZE - w) / 2), top: Math.round((SIZE - h) / 2) };
}

const board = (background) => sharp({ create: { width: SIZE, height: SIZE, channels: 4, background } });
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };

await board(PINE).composite([await wordmark(SQUARE_WIDTH, CREAM)]).removeAlpha().png().toFile(path.join(out, 'icon.png'));
await board(CLEAR).composite([await wordmark(ADAPTIVE_WIDTH, CREAM)]).png().toFile(path.join(out, 'android-icon-foreground.png'));
await board(CLEAR).composite([await wordmark(ADAPTIVE_WIDTH, '#FFFFFF')]).png().toFile(path.join(out, 'android-icon-monochrome.png'));
console.log(`wrote icon.png, android-icon-foreground.png and android-icon-monochrome.png to ${path.relative(root, out)}`);
