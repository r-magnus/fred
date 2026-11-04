import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layout, spans } from '../src/reply-format.ts';

const words = (s: readonly { text: string }[]) => s.map((x) => x.text).join('');

test('a card reads as summary, steps, one warning group and a bold call for help', () => {
  const card = [
    'Heavy bleeding can kill in a few minutes, so act on it before anything else.',
    '1. Uncover the wound so you can see where the blood is coming from.',
    '2. Press hard and directly on the spot that is bleeding most.',
    "Don't loosen or take off a tourniquet once it is on.",
    "Don't put a tourniquet around the neck.",
    'This is an emergency. Get the person to medical care as fast as you can.',
  ].join('\n');
  const b = layout(card);
  assert.deepEqual(b.map((x) => x.kind), ['para', 'step', 'step', 'warn', 'para']);
  assert.equal(b[1]!.kind === 'step' && b[1]!.n, 1);
  const warn = b[3]!;
  assert.ok(warn.kind === 'warn' && warn.lines.length === 2);
  assert.deepEqual(warn.lines[0]![0], { text: "Don't", bold: true });
  const help = b[4]!;
  assert.ok(help.kind === 'para');
  assert.deepEqual(help.spans[0], { text: 'This is an emergency.', bold: true });
});

test('no word is added, dropped or changed', () => {
  const text = "Snow blindness is a sunburn of the eye.\n1. Watch for signs of a concussion or worse: headache, nausea.\nDon't rub the eyes.\nGet medical help if it doesn't settle.";
  const back = layout(text).map((b) =>
    b.kind === 'warn' ? b.lines.map(words).join('\n')
      : b.kind === 'heading' ? b.text
        : b.kind === 'step' ? `${b.n}. ${words(b.spans)}` : words(b.spans)).join('\n');
  assert.equal(back, text);
});

test('a short label before a colon is bold; a long sentence with a colon is not', () => {
  const [a] = layout('1. Watch for signs of a concussion or worse: headache, nausea.');
  assert.ok(a!.kind === 'step');
  assert.deepEqual(a.spans[0], { text: 'Watch for signs of a concussion or worse:', bold: true });
  const [b] = layout('If it is an arm or leg and pressure is not stopping it after several long minutes of pressing: tie it.');
  assert.ok(b!.kind === 'para' && b.spans.every((s) => !s.bold));
});

test('half-streamed text does not break the layout', () => {
  assert.deepEqual(spans('Press **hard'), [{ text: 'Press **hard', bold: false }]);
  assert.deepEqual(spans('Press **hard** now'), [
    { text: 'Press ', bold: false }, { text: 'hard', bold: true }, { text: ' now', bold: false }]);
  assert.deepEqual(layout('Get into shade.\n2').map((b) => b.kind), ['para', 'para']);
  assert.deepEqual(layout(''), []);
});

test('bullets and headings from the model are honoured', () => {
  const b = layout('### Signs\n- headache\n* dizziness');
  assert.deepEqual(b.map((x) => x.kind), ['heading', 'bullet', 'bullet']);
});
