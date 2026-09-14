import { parse } from 'yaml';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export type AmbiguousComposeService = Error & {
  code: 'ambiguous_compose_service';
  found: string[];
};

function ambiguous(found: string[], detail: string): AmbiguousComposeService {
  const e = new Error(
    found.length
      ? `Ambiguous compose service: ${found.length} services found (${found.join(', ')}). ` +
        `The panel refuses to guess which one to point at the new image.`
      : `Ambiguous compose service: ${detail}`
  ) as AmbiguousComposeService;
  e.code = 'ambiguous_compose_service';
  e.found = found;
  return e;
}

export function detectComposeService(text: string): string {
  let doc: any;
  try {
    doc = parse(text);
  } catch (err) {
    throw ambiguous([], `the file is not valid YAML (${(err as Error).message})`);
  }
  const services = doc?.services;
  const keys = services && typeof services === 'object' ? Object.keys(services) : [];
  if (keys.length === 1) return keys[0];
  throw ambiguous(keys, keys.length === 0 ? 'the file declares no services' : '');
}

export function renderOverride(service: string, image: string): string {
  // Only `image:` — the override declares no paths, so it is order-agnostic
  // and can never alter volumes, ports, or environment.
  return `services:\n  ${JSON.stringify(service)}:\n    image: ${JSON.stringify(image)}\n`;
}

export function overridePath(projectPath: string, service: string): string {
  return join(projectPath, '.rfid-panel', `compose-${service}.yml`);
}

export async function writeOverride(
  projectPath: string,
  service: string,
  image: string
): Promise<string> {
  const target = overridePath(projectPath, service);
  await mkdir(dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  await writeFile(tmp, renderOverride(service, image), 'utf8');
  await rename(tmp, target);   // atomic replace
  return target;
}

export function composeArgs(baseFile: string, overrideFile?: string): string[] {
  // Base first: with several -f flags compose takes the project name and the
  // base for relative paths from the FIRST file. The shipped files use relative
  // mounts (./config.toml, ./config), so reversing this breaks them.
  return overrideFile ? ['-f', baseFile, '-f', overrideFile] : ['-f', baseFile];
}
