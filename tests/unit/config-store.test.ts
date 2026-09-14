import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'smol-toml';
import { SCHEMAS } from '../../src/lib/server/config/schema';
import { readConfig, validateConfig, writeConfig, renderToml } from '../../src/lib/server/config/store';

let dir: string, file: string;
// Shaped like the shipped reader config: flat scalar keys, a [filter] table
// and an [[antennas]] array.
const sample = `
reader_name = "Gate A"
speedway_address = "192.168.55.12"
socket_port = 11000
unknown_extra = "keep me"

[filter]
enabled = false

[[antennas]]
ant_id = 1
tx_power = 17.0
rx_sensitivity = -60.0
enable = true
`;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  file = path.join(dir, 'config.toml');
  fs.writeFileSync(file, sample);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const flat = (v: any) => v[''];

describe('readConfig', () => {
  it('returns schema keys with values parsed', () => {
    const v: any = readConfig(file, SCHEMAS.reader);
    expect(flat(v).speedway_address).toBe('192.168.55.12');
    expect(v.antennas[0].tx_power).toBe(17);
    expect(v.antennas[0].enable).toBe(true);
    expect(v.filter.enabled).toBe(false);
  });

  it('fills defaults for missing keys', () => {
    const v: any = readConfig(file, SCHEMAS.reader);
    expect(flat(v).session).toBe(1);
    expect(flat(v).rf_mode).toBe(2);
    expect(flat(v).tag_population).toBe(20);
  });
});

describe('validateConfig', () => {
  it('accepts a good value', () => {
    const v: any = readConfig(file, SCHEMAS.reader);
    expect(validateConfig(SCHEMAS.reader, v).ok).toBe(true);
  });

  it('rejects an out-of-range number and names the flat path', () => {
    const v: any = readConfig(file, SCHEMAS.reader);
    flat(v).socket_port = 99999;
    const r = validateConfig(SCHEMAS.reader, v);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].path).toBe('socket_port');
  });

  it('rejects an unknown enum value', () => {
    const v: any = readConfig(file, SCHEMAS.reader);
    flat(v).rf_mode = 42;
    expect(validateConfig(SCHEMAS.reader, v).ok).toBe(false);
  });

  it('rejects a wrong-typed boolean', () => {
    const v: any = readConfig(file, SCHEMAS.reader);
    v.filter.enabled = 'yes';
    expect(validateConfig(SCHEMAS.reader, v).ok).toBe(false);
  });

  it('rejects a non-numeric antenna array', () => {
    const v: any = readConfig(file, SCHEMAS.gate);
    v.gates = [{ gate_id: '1', ant: ['one'], ipcame_gateway_address: 'x', ipcame_port: 5555, camera_id: 0 }];
    const r = validateConfig(SCHEMAS.gate, v);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.path)).toContain('gates.0.ant');
  });
});

describe('writeConfig', () => {
  it('writes the new value, keeps unknown keys, and leaves a .bak', () => {
    const v: any = readConfig(file, SCHEMAS.reader);
    flat(v).speedway_address = '10.0.0.5';
    const res = writeConfig(file, SCHEMAS.reader, v);
    expect(res.ok).toBe(true);
    const after: any = parse(fs.readFileSync(file, 'utf8'));
    expect(after.speedway_address).toBe('10.0.0.5');
    expect(after.unknown_extra).toBe('keep me'); // unknown key preserved
    expect(after.filter.tag_mask).toBe('0000'); // filled default merged in
    expect(fs.existsSync(res.backup)).toBe(true);
  });

  it('does not leave a temp file behind', () => {
    writeConfig(file, SCHEMAS.reader, readConfig(file, SCHEMAS.reader));
    const leftovers = fs.readdirSync(dir).filter((f) => f.includes('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('round-trips the shipped gate file without corrupting it', () => {
    const gateFile = path.join(dir, 'gate.toml');
    fs.writeFileSync(gateFile, `
socket_port = 11000
mqtt_broker_address = "tcp://localhost:1883"
search_mode = 2
event_id = 10003

[[gates]]
gate_id = "10001"
ant = [1, 2]
ipcame_gateway_address = "localhost"
ipcame_port = 5555
camera_id = 0
`);
    const v: any = readConfig(gateFile, SCHEMAS.gate);
    expect(v.gates[0].ant).toEqual([1, 2]);
    expect(typeof v.gates[0].gate_id).toBe('string');
    writeConfig(gateFile, SCHEMAS.gate, v);
    const after: any = parse(fs.readFileSync(gateFile, 'utf8'));
    expect(after.gates[0].ant).toEqual([1, 2]);
    expect(after.search_mode).toBe(2);
  });
});

describe('renderToml', () => {
  it('renders schema-ordered toml that round-trips', () => {
    const v: any = readConfig(file, SCHEMAS.reader);
    const text = renderToml(SCHEMAS.reader, v);
    const back: any = parse(text);
    expect(back.speedway_address).toBe('192.168.55.12');
    expect(back.antennas.length).toBe(1);
    expect(back.filter.enabled).toBe(false);
  });
});
