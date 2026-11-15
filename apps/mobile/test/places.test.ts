import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MapIndex, StateBundle } from '../src/map-downloads.ts';
import { mergeBundles, orderPlaces, placeBundle, placeName, placesOf, regionOnly } from '../src/places.ts';

const file = (path: string, bytes: number) => ({ path, asset: path, bytes, md5: 'x' });
const bundle = (files: ReturnType<typeof file>[], baseUrl?: string): StateBundle => ({
  bytes: files.reduce((a, f) => a + f.bytes, 0), files, missing: [], ...(baseUrl === undefined ? {} : { baseUrl }),
});

const IDX: MapIndex = {
  schemaVersion: 1, release: 't', baseUrl: 'http://local/',
  states: {
    CA: bundle([file('map-CA-z14.pmtiles', 600)], 'https://release/'),
    NV: bundle([file('map-NV-z14.pmtiles', 300)], 'https://release/'),
  },
  overview: bundle([file('map-US-overview.pmtiles', 18)]),
  regions: {
    CA: {
      base: bundle([file('map-CA-overview.pmtiles', 19), file('regions-CA.json', 1)]),
      regions: {
        south: { ...bundle([file('map-CA-south.pmtiles', 160)]), name: 'Southern California' },
        bay: { ...bundle([file('map-CA-bay.pmtiles', 110)]), name: 'Bay Area and Central Coast' },
      },
      outline: { schemaVersion: 1, state: 'CA', regions: [{ id: 'north', name: 'Northern California', rings: [] }], edges: [] },
    },
  },
};

test('a split state offers its regions; any other state, itself', () => {
  assert.deepEqual(placesOf(IDX, 'CA'), ['CA/south', 'CA/bay']);
  assert.deepEqual(placesOf(IDX, 'NV'), ['NV']);
});

test('a region downloads with the state-wide part and the overview', () => {
  const b = placeBundle(IDX, 'CA/south')!;
  assert.deepEqual(b.files.map((f) => f.path),
    ['map-CA-south.pmtiles', 'map-CA-overview.pmtiles', 'regions-CA.json', 'map-US-overview.pmtiles']);
  assert.equal(b.bytes, 160 + 19 + 1 + 18);
});

test('a whole state downloads with the overview, each file from its own server', () => {
  const b = placeBundle(IDX, 'NV')!;
  assert.deepEqual(b.files.map((f) => [f.path, f.baseUrl]),
    [['map-NV-z14.pmtiles', 'https://release/'], ['map-US-overview.pmtiles', undefined]]);
});

test('a place the list does not have is undefined', () => {
  assert.equal(placeBundle(IDX, 'CA/east'), undefined);
  assert.equal(placeBundle(IDX, 'ZZ'), undefined);
});

test('two regions together count the shared files once', () => {
  const both = mergeBundles([placeBundle(IDX, 'CA/south')!, placeBundle(IDX, 'CA/bay')!]);
  assert.equal(both.bytes, 160 + 110 + 19 + 1 + 18);
});

test('removing a region takes only its own files', () => {
  assert.deepEqual(regionOnly(IDX, 'CA/bay')!.files.map((f) => f.path), ['map-CA-bay.pmtiles']);
  assert.equal(regionOnly(IDX, 'NV'), undefined);
});

test('places are named in words', () => {
  const names = { CA: 'California', NV: 'Nevada' };
  assert.equal(placeName(IDX, 'CA/south', names), 'Southern California');
  assert.equal(placeName(IDX, 'CA/north', names), 'Northern California', 'from the outline when the list lacks it');
  assert.equal(placeName(IDX, 'NV', names), 'Nevada');
  assert.equal(placeName(null, 'CA/x', names), 'California (x)');
});

test('the hiker\'s region comes first within its state', () => {
  assert.deepEqual(orderPlaces(IDX, ['CA', 'NV'], 'CA/bay'), ['CA/bay', 'CA/south', 'NV']);
  assert.deepEqual(orderPlaces(IDX, ['NV', 'CA'], null), ['NV', 'CA/south', 'CA/bay']);
});
