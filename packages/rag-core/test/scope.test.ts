import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asRequest, scopeScore } from '../src/scope.ts';

test('scopeScore: weights times the vector at the training length, plus the bias', () => {
  const model = { w: [1, -1], b: 0.5, scale: 4, threshold: 0 };
  // (3, 4) has length 5; scaled to length 4 it is (2.4, 3.2).
  assert.ok(Math.abs(scopeScore(model, new Float32Array([3, 4])) - (2.4 - 3.2 + 0.5)) < 1e-6);
  // The vector's own length does not matter.
  assert.ok(Math.abs(scopeScore(model, new Float32Array([30, 40])) - scopeScore(model, new Float32Array([3, 4]))) < 1e-6);
  assert.equal(scopeScore(model, new Float32Array([0, 0])), 0.5);
});

test('asRequest: a statement becomes a request for what to do', () => {
  assert.equal(asRequest('my husband just sliced his palm on a tin can.'), 'my husband just sliced his palm on a tin can. what should i do?');
  assert.equal(asRequest('rolled my ankle on a rock'), 'rolled my ankle on a rock. what should i do?');
});
