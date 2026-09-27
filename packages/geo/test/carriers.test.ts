import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carrierFromSim, insideState, MAJOR_CARRIERS } from '../src/index.ts';

const ATT = '130077', TMO = '130403', VZW = '131425';

test('the national networks are named by FCC provider id', () => {
  assert.equal(MAJOR_CARRIERS[ATT], 'AT&T');
  assert.equal(MAJOR_CARRIERS[TMO], 'T-Mobile');
  assert.equal(MAJOR_CARRIERS[VZW], 'Verizon');
});

test('network codes resolve to the host network', () => {
  assert.equal(carrierFromSim({ mcc: '310', mnc: '410' }), ATT);
  assert.equal(carrierFromSim({ mcc: '310', mnc: '260' }), TMO);
  assert.equal(carrierFromSim({ mcc: '311', mnc: '480' }), VZW);
  // A dropped leading zero still resolves.
  assert.equal(carrierFromSim({ mcc: '310', mnc: '4' }), VZW);
});

test('the code wins over the brand on the SIM', () => {
  // Mint's SIM says "Mint" but carries T-Mobile's code.
  assert.equal(carrierFromSim({ mcc: '310', mnc: '260', name: 'Mint Mobile' }), TMO);
});

test('single-network brands resolve by name when the code does not', () => {
  assert.equal(carrierFromSim({ name: 'Visible' }), VZW);
  assert.equal(carrierFromSim({ name: 'Cricket' }), ATT);
  assert.equal(carrierFromSim({ name: 'Mint Mobile' }), TMO);
  assert.equal(carrierFromSim({ mcc: '310', mnc: '999', name: 'Metro by T-Mobile' }), TMO);
});

test('multi-network brands and nothing at all stay unknown', () => {
  // Straight Talk SIMs exist on every network; a guess would draw false gaps.
  assert.equal(carrierFromSim({ name: 'Straight Talk' }), null);
  assert.equal(carrierFromSim({}), null);
  assert.equal(carrierFromSim({ mcc: null, mnc: null, name: '' }), null);
});

test('insideState does not snap across the line', () => {
  assert.equal(insideState(37.8651, -119.5383, 'CA'), true);   // Yosemite
  assert.equal(insideState(37.8651, -119.5383, 'NV'), false);
  assert.equal(insideState(36.5, -123.5, 'CA'), false);         // Pacific
  assert.equal(insideState(0, 0, 'ZZ'), false);
});
