/**
 * A minimal Mapbox Vector Tile decoder: just enough to read lines and polygons
 * with their tags out of the state map archives, for routing (#223).
 *
 * MapLibre decodes the same tiles for drawing, but natively and out of reach of
 * JS, so the route engine reads the tile bytes itself. The format is a small
 * protobuf (spec 2.1): layers of features, each with tag indexes into the
 * layer's key and value tables and a geometry of zig-zag delta commands.
 *
 * Deliberately no `pbf` / `@mapbox/vector-tile` dependency: neither is in the
 * app today, and the subset needed here is about a hundred lines.
 */

export type TagValue = string | number | boolean;

export interface TileFeature {
  /** 1 point, 2 line, 3 polygon. */
  readonly type: 1 | 2 | 3;
  readonly tags: Readonly<Record<string, TagValue>>;
  /**
   * Lines: one entry per line part. Polygons: rings, outer first, holes after
   * (winding tells them apart; not needed by any caller yet). Coordinates are
   * in tile units, 0..extent, and can run slightly past the edge (the buffer).
   */
  readonly geometry: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
}

export interface TileLayer {
  readonly name: string;
  readonly extent: number;
  readonly features: readonly TileFeature[];
}

interface Cursor { pos: number }

function readVarint(b: Uint8Array, c: Cursor): number {
  let result = 0;
  let shift = 0;
  for (;;) {
    const byte = b[c.pos++];
    if (byte === undefined) throw new Error('mvt: truncated varint');
    result += (byte & 0x7f) * 2 ** shift;
    if (byte < 0x80) return result;
    shift += 7;
  }
}

/** Walks one protobuf message, calling `field` for every field it holds. */
function eachField(
  b: Uint8Array, start: number, end: number,
  field: (num: number, wire: number, c: Cursor, len: number) => void,
): void {
  const c: Cursor = { pos: start };
  while (c.pos < end) {
    const key = readVarint(b, c);
    const num = Math.floor(key / 8);
    const wire = key & 7;
    if (wire === 0) {
      const at = c.pos;
      readVarint(b, c);
      const after = c.pos;
      c.pos = at;
      field(num, wire, c, 0);
      c.pos = after;
    } else if (wire === 2) {
      const len = readVarint(b, c);
      const at = c.pos;
      field(num, wire, c, len);
      c.pos = at + len;
    } else if (wire === 5) {
      const at = c.pos;
      field(num, wire, c, 4);
      c.pos = at + 4;
    } else if (wire === 1) {
      const at = c.pos;
      field(num, wire, c, 8);
      c.pos = at + 8;
    } else {
      throw new Error(`mvt: unsupported wire type ${wire}`);
    }
  }
}

const utf8 = new TextDecoder('utf-8');

function readValue(b: Uint8Array, start: number, end: number): TagValue {
  let value: TagValue = '';
  eachField(b, start, end, (num, _wire, c, len) => {
    const view = new DataView(b.buffer, b.byteOffset + c.pos, Math.max(len, 0));
    switch (num) {
      case 1: value = utf8.decode(b.subarray(c.pos, c.pos + len)); break;
      case 2: value = view.getFloat32(0, true); break;
      case 3: value = view.getFloat64(0, true); break;
      case 4: case 5: value = readVarint(b, c); break;
      case 6: { const v = readVarint(b, c); value = v % 2 === 0 ? v / 2 : -(v + 1) / 2; break; }
      case 7: value = readVarint(b, c) !== 0; break;
    }
  });
  return value;
}

function readPacked(b: Uint8Array, start: number, len: number): number[] {
  const out: number[] = [];
  const c: Cursor = { pos: start };
  while (c.pos < start + len) out.push(readVarint(b, c));
  return out;
}

const zigzag = (n: number): number => (n % 2 === 0 ? n / 2 : -(n + 1) / 2);

function decodeGeometry(cmds: readonly number[]): Array<Array<[number, number]>> {
  const parts: Array<Array<[number, number]>> = [];
  let x = 0;
  let y = 0;
  let current: Array<[number, number]> | null = null;
  for (let i = 0; i < cmds.length;) {
    const cmd = cmds[i++]!;
    const id = cmd & 7;
    const count = cmd >> 3;
    if (id === 7) {
      // ClosePath: repeat the first point, so callers see closed rings.
      if (current !== null && current.length > 0) current.push([current[0]![0], current[0]![1]]);
      continue;
    }
    for (let k = 0; k < count; k++) {
      x += zigzag(cmds[i++]!);
      y += zigzag(cmds[i++]!);
      if (id === 1) {
        current = [[x, y]];
        parts.push(current);
      } else if (current !== null) {
        current.push([x, y]);
      }
    }
  }
  return parts;
}

/**
 * Decodes the named layers of a tile (all layers when `only` is omitted).
 * Skipping the rest matters: buildings and POIs are most of a town tile.
 */
export function decodeTile(bytes: Uint8Array, only?: readonly string[]): Map<string, TileLayer> {
  const layers = new Map<string, TileLayer>();
  eachField(bytes, 0, bytes.length, (num, wire, c, len) => {
    if (num !== 3 || wire !== 2) return;
    const start = c.pos;
    const end = start + len;
    // First pass: the name, so unwanted layers cost one scan and no decoding.
    let name = '';
    eachField(bytes, start, end, (n2, _w, c2, l2) => {
      if (n2 === 1) name = utf8.decode(bytes.subarray(c2.pos, c2.pos + l2));
    });
    if (only !== undefined && !only.includes(name)) return;
    const keys: string[] = [];
    const values: TagValue[] = [];
    const raw: Array<{ type: number; tags: number[]; geom: number[] }> = [];
    let extent = 4096;
    eachField(bytes, start, end, (n2, _w, c2, l2) => {
      if (n2 === 3) keys.push(utf8.decode(bytes.subarray(c2.pos, c2.pos + l2)));
      else if (n2 === 4) values.push(readValue(bytes, c2.pos, c2.pos + l2));
      else if (n2 === 5) extent = readVarint(bytes, c2);
      else if (n2 === 2) {
        const f = { type: 0, tags: [] as number[], geom: [] as number[] };
        eachField(bytes, c2.pos, c2.pos + l2, (n3, _w3, c3, l3) => {
          if (n3 === 2) f.tags = readPacked(bytes, c3.pos, l3);
          else if (n3 === 3) f.type = readVarint(bytes, c3);
          else if (n3 === 4) f.geom = readPacked(bytes, c3.pos, l3);
        });
        raw.push(f);
      }
    });
    const features: TileFeature[] = [];
    for (const f of raw) {
      if (f.type !== 1 && f.type !== 2 && f.type !== 3) continue;
      const tags: Record<string, TagValue> = {};
      for (let i = 0; i + 1 < f.tags.length; i += 2) {
        const k = keys[f.tags[i]!];
        const v = values[f.tags[i + 1]!];
        if (k !== undefined && v !== undefined) tags[k] = v;
      }
      features.push({ type: f.type, tags, geometry: decodeGeometry(f.geom) });
    }
    layers.set(name, { name, extent, features });
  });
  return layers;
}
