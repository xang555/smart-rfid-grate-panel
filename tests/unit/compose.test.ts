import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import {
  detectComposeService, renderOverride, overridePath, writeOverride, composeArgs
} from '../../src/lib/server/proc/compose';

// Trimmed from the shipped project files.
const IPCAME = `
version: '3.8'
services:
  app:
    image: registry.gitlab.com/laoitdev/23-s-asian-ipcame-service
    volumes:
      - ./config.toml:/usr/src/app/config.toml
    ports:
      - "5555:5555"
`;
const TWO_SERVICES = `
services:
  app:
    image: a
  sidecar:
    image: b
`;
const NO_SERVICES = `version: '3.8'\n`;

describe('detectComposeService', () => {
  it('returns the single service key', () => {
    expect(detectComposeService(IPCAME)).toBe('app');
  });

  it('returns a non-identifier service key verbatim', () => {
    expect(detectComposeService('services:\n  rfid_gate_service:\n    image: x\n'))
      .toBe('rfid_gate_service');
  });

  it('throws ambiguous for several services, naming them', () => {
    expect(() => detectComposeService(TWO_SERVICES)).toThrowError(/ambiguous/i);
    try {
      detectComposeService(TWO_SERVICES);
    } catch (e: any) {
      expect(e.code).toBe('ambiguous_compose_service');
      expect(e.found.sort()).toEqual(['app', 'sidecar']);
    }
  });

  it('throws ambiguous for zero services', () => {
    expect(() => detectComposeService(NO_SERVICES)).toThrowError(/ambiguous/i);
  });

  it('throws for unparseable YAML rather than guessing', () => {
    expect(() => detectComposeService('services: [unclosed')).toThrow();
  });
});

describe('renderOverride', () => {
  it('produces a one-service document with only the image', () => {
    const y = parse(renderOverride('app', 'registry.gitlab.com/x/y:v2'));
    expect(y).toEqual({ services: { app: { image: 'registry.gitlab.com/x/y:v2' } } });
  });

  it('merges over the base file with the image replaced and volumes intact', () => {
    // Compose merges -f files deep: maps merge, scalars override. Simulate at
    // the services.app level the way docker compose would.
    const base: any = parse(IPCAME);
    const over: any = parse(renderOverride('app', 'new:1'));
    const merged: any = {
      ...base,
      services: {
        ...base.services,
        ...over.services,
        app: { ...base.services.app, ...over.services.app }
      }
    };
    expect(merged.services.app.image).toBe('new:1');
    expect(merged.services.app.volumes).toEqual(['./config.toml:/usr/src/app/config.toml']);
  });
});

describe('composeArgs', () => {
  it('omits the override when none is given', () => {
    expect(composeArgs('/p/ipcame/docker-compose.yml'))
      .toEqual(['-f', '/p/ipcame/docker-compose.yml']);
  });

  it('puts the base file first so relative paths resolve', () => {
    expect(composeArgs('/p/ipcame/docker-compose.yml', '/p/.rfid-panel/compose-app.yml'))
      .toEqual(['-f', '/p/ipcame/docker-compose.yml', '-f', '/p/.rfid-panel/compose-app.yml']);
  });
});

describe('writeOverride', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'compose-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('creates .rfid-panel and writes the override', async () => {
    const p = await writeOverride(dir, 'app', 'new:1');
    expect(p).toBe(overridePath(dir, 'app'));
    expect(parse(await readFile(p, 'utf8'))).toEqual({ services: { app: { image: 'new:1' } } });
  });

  it('regenerates rather than appends on a second write', async () => {
    await writeOverride(dir, 'app', 'first:1');
    await writeOverride(dir, 'app', 'second:2');
    expect(parse(await readFile(overridePath(dir, 'app'), 'utf8')))
      .toEqual({ services: { app: { image: 'second:2' } } });
  });

  it('is idempotent when the directory already exists', async () => {
    await mkdir(join(dir, '.rfid-panel'), { recursive: true });
    await expect(writeOverride(dir, 'app', 'x:1')).resolves.toBe(overridePath(dir, 'app'));
  });
});
