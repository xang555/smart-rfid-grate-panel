import { describe, it, expect } from 'vitest';
import { SCHEMAS, CONFIG_FILES, getField } from '../../src/lib/server/config/schema';

describe('config schema', () => {
  it('covers exactly the three config files', () => {
    expect(CONFIG_FILES).toEqual(['reader', 'cameras', 'gate']);
    for (const f of CONFIG_FILES) expect(SCHEMAS[f]).toBeTruthy();
  });

  it('reader schema has human labels and raw keys on the flat section', () => {
    const reader = SCHEMAS.reader;
    // The shipped config.toml keeps reader keys at the top level (no [reader] table).
    const ip = getField(reader, '', 'speedway_address');
    expect(ip?.label).toBe('Reader IP address');
    expect(ip?.type).toBe('string');
    const rfMode = getField(reader, '', 'rf_mode');
    expect(rfMode?.type).toBe('enum');
    expect(rfMode?.enum?.find((e) => e.value === 2)?.label).toBe('Dense Reader M4');
  });

  it('reader has a nested filter section and an antennas array with labels', () => {
    const filter = SCHEMAS.reader.root.find((s) => s.key === 'filter');
    expect(filter?.isArray).toBeUndefined();
    expect(getField(SCHEMAS.reader, 'filter', 'enabled')?.type).toBe('boolean');
    const antennas = SCHEMAS.reader.root.find((s) => s.key === 'antennas');
    expect(antennas?.isArray).toBe(true);
    expect(antennas?.fields.find((f) => f.key === 'tx_power')?.label).toBe('Tx power (dBm)');
  });

  it('cameras has a flat service section and an ipcame array with a password field flagged', () => {
    expect(getField(SCHEMAS.cameras, '', 'SERVICE_PORT')?.type).toBe('number');
    const arr = SCHEMAS.cameras.root.find((s) => s.key === 'ipcame');
    expect(arr?.isArray).toBe(true);
    expect(arr?.fields.find((f) => f.key === 'IP_CAMERA_PASSWORD')?.secret).toBe(true);
  });

  it('gate schema is flat with mqtt fields and a gates array of string ids and antenna lists', () => {
    const gates = SCHEMAS.gate.root.find((s) => s.key === 'gates');
    expect(gates?.isArray).toBe(true);
    expect(getField(SCHEMAS.gate, '', 'mqtt_broker_address')?.label).toBe('MQTT broker address');
    expect(gates?.fields.find((f) => f.key === 'gate_id')?.type).toBe('string');
    expect(gates?.fields.find((f) => f.key === 'ant')?.type).toBe('array<number>');
    // The shipped file stores search_mode as a number (1 = single, 2 = dual).
    expect(getField(SCHEMAS.gate, '', 'search_mode')?.type).toBe('enum');
  });

  it('every field has a non-empty label', () => {
    for (const f of CONFIG_FILES) {
      for (const s of SCHEMAS[f].root) {
        for (const fld of s.fields) expect(fld.label.length).toBeGreaterThan(0);
      }
    }
  });
});
