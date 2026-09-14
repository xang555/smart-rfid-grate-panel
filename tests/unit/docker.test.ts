import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  runComposeUp, runComposeDown, runComposePull, composeStatus, dockerAvailable,
  hasLocalImage, setExecForTests, resetExecForTests
} from '../../src/lib/server/proc/docker';

let calls: { cmd: string; args: string[] }[] = [];
let next: any;

beforeEach(() => {
  calls = [];
  setExecForTests(async (cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    return typeof next === 'function' ? next(cmd, args) : next;
  });
});
afterEach(() => resetExecForTests());

describe('docker wrapper', () => {
  const BASE = ['-f', '/p/ipcame/docker-compose.yml'];
  const WITH_OVERRIDE = [...BASE, '-f', '/p/.rfid-panel/compose-ipcame.yml'];

  it('runs compose up with the given file args and -d', async () => {
    next = { code: 0, stdout: '', stderr: '' };
    const r = await runComposeUp(BASE);
    expect(r.code).toBe(0);
    expect(calls[0].cmd).toBe('docker');
    expect(calls[0].args).toEqual(['compose', '-f', '/p/ipcame/docker-compose.yml', 'up', '-d']);
  });

  it('runs compose up with an override file when one is passed', async () => {
    next = { code: 0, stdout: '', stderr: '' };
    await runComposeUp(WITH_OVERRIDE);
    expect(calls[0].args).toEqual([
      'compose', '-f', '/p/ipcame/docker-compose.yml',
      '-f', '/p/.rfid-panel/compose-ipcame.yml', 'up', '-d'
    ]);
  });

  it('runs compose down with the file args', async () => {
    next = { code: 0, stdout: '', stderr: '' };
    await runComposeDown(['-f', '/p/rfid/docker-compose.yml']);
    expect(calls[0].args).toEqual(['compose', '-f', '/p/rfid/docker-compose.yml', 'down']);
  });

  it('runs compose pull for a named service', async () => {
    next = { code: 0, stdout: 'Pulled\n', stderr: '' };
    await runComposePull(WITH_OVERRIDE, 'app');
    expect(calls[0].args).toEqual([
      'compose', '-f', '/p/ipcame/docker-compose.yml',
      '-f', '/p/.rfid-panel/compose-ipcame.yml', 'pull', 'app'
    ]);
  });

  it('reports running when ps lists a running service', async () => {
    next = { code: 0, stdout: 'running\n', stderr: '' };
    expect(await composeStatus(BASE)).toBe('running');
  });

  it('reports stopped when ps output has no running service', async () => {
    next = { code: 1, stdout: '', stderr: 'no configuration file provided' };
    expect(await composeStatus(BASE)).toBe('stopped');
  });

  it('hasLocalImage is true when docker image inspect succeeds', async () => {
    next = { code: 0, stdout: '[]', stderr: '' };
    expect(await hasLocalImage('registry.gitlab.com/laoitdev/23-s-asian-ipcame-service')).toBe(true);
    expect(calls[0].args).toEqual([
      'image', 'inspect', 'registry.gitlab.com/laoitdev/23-s-asian-ipcame-service'
    ]);
  });

  it('hasLocalImage is false when the image is absent and does not throw', async () => {
    next = { code: 1, stdout: '', stderr: 'Error: No such image' };
    expect(await hasLocalImage('missing:latest')).toBe(false);
  });

  it('hasLocalImage is false when docker itself throws', async () => {
    setExecForTests(async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); });
    expect(await hasLocalImage('x:1')).toBe(false);
  });

  it('dockerAvailable is true when docker version succeeds', async () => {
    next = { code: 0, stdout: 'Docker version 27', stderr: '' };
    expect(await dockerAvailable()).toBe(true);
    expect(calls[0].args).toEqual(['version']);
  });

  it('dockerAvailable is false when docker is missing', async () => {
    setExecForTests(async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); });
    expect(await dockerAvailable()).toBe(false);
  });
});
