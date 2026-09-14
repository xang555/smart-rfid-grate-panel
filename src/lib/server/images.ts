import fs from 'node:fs';
import type Database from 'better-sqlite3';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getConfig, setConfig, getProjectPath } from './settings';
import { runComposePull, hasLocalImage } from './proc/docker';
import { detectComposeService, composeArgs, writeOverride, overridePath } from './proc/compose';

export type DockerService = 'ipcame' | 'rfid';
export type PullPolicy = 'always' | 'never';
export type ImageConfig = { image: string; policy: PullPolicy };

export type ImageStatus = {
  service: DockerService;
  image: string;
  effectiveImage: string;
  policy: PullPolicy;
  composeFile: string;
  composeService: string | null;
  localDigest: string | null;
  error: string | null;
};

// Untagged refs must be accepted: the shipped images are untagged and resolve
// to :latest. A leading dash is rejected so a ref can never parse as a flag.
const IMAGE_RE = /^[a-zA-Z0-9][\w.\-/:@]*$/;

export function validateImageRef(ref: string): { ok: true } | { ok: false; message: string } {
  const t = ref.trim();
  if (!t) return { ok: false, message: 'Image reference is empty.' };
  if (t.startsWith('-')) {
    return { ok: false, message: 'Image reference cannot start with a dash.' };
  }
  if (/\s/.test(t)) {
    return { ok: false, message: 'Image reference cannot contain whitespace.' };
  }
  if (!IMAGE_RE.test(t)) {
    return { ok: false, message: 'Image reference contains an unsupported character.' };
  }
  return { ok: true };
}

export function composeFileFor(service: DockerService): string {
  return service === 'ipcame' ? 'ipcame/docker-compose.yml' : 'rfid/docker-compose.yml';
}

export function imageConfig(db: Database.Database, service: DockerService): ImageConfig {
  return {
    image: getConfig(db, `docker_image_${service}`) ?? '',
    policy: (getConfig(db, `docker_pull_${service}`) as PullPolicy) ?? 'always'
  };
}

export function setImageConfig(
  db: Database.Database, service: DockerService, patch: Partial<ImageConfig>
): ImageConfig {
  if (patch.image !== undefined) setConfig(db, `docker_image_${service}`, patch.image.trim());
  if (patch.policy !== undefined) setConfig(db, `docker_pull_${service}`, patch.policy);
  return imageConfig(db, service);
}

export function resolveImage(db: Database.Database, service: DockerService, baseImage: string): string {
  return imageConfig(db, service).image || baseImage;
}

// The image the base compose file declares, used for `effectiveImage`.
function baseImageFrom(project: string, service: DockerService): string {
  try {
    const text = fs.readFileSync(join(project, composeFileFor(service)), 'utf8');
    const key = detectComposeService(text);
    const re = new RegExp(`^\\s{2}${key}:\\s*$[\\s\\S]*?^\\s{4}image:\\s*(\\S+)`, 'm');
    return text.match(re)?.[1] ?? '';
  } catch {
    return '';
  }
}

export function composeServiceFor(db: Database.Database, service: DockerService): string | null {
  try {
    const text = fs.readFileSync(
      join(getProjectPath(db), composeFileFor(service)), 'utf8'
    );
    return detectComposeService(text);
  } catch {
    return null;
  }
}

// The args a compose call needs for this service, writing the override first
// when an image is configured. Returns the file args plus the detected service.
export async function prepareCompose(
  db: Database.Database, service: DockerService
): Promise<{ args: string[]; composeService: string | null }> {
  const project = getProjectPath(db);
  const base = join(project, composeFileFor(service));
  const cfg = imageConfig(db, service);

  if (!cfg.image) {
    return { args: composeArgs(base), composeService: composeServiceFor(db, service) };
  }

  // Configured image: the override needs a service key, and guessing one in a
  // multi-service stack would be worse than refusing. detectComposeService
  // throws AmbiguousComposeService carrying `.found` for the settings card.
  const text = await readFile(base, 'utf8');
  const key = detectComposeService(text);
  const override = await writeOverride(project, key, cfg.image);
  return { args: composeArgs(base, override), composeService: key };
}

export async function pull(
  db: Database.Database,
  service: DockerService,
  onLog: (line: string) => void
): Promise<{ ok: boolean; warn?: string }> {
  const cfg = imageConfig(db, service);
  if (cfg.policy === 'never') return { ok: true };

  // prepareCompose throws AmbiguousComposeService when an image is set over a
  // multi-service file; the caller turns that into a failed start. With no
  // image configured there is nothing to override and nothing to pull.
  const { args, composeService } = await prepareCompose(db, service);
  if (!cfg.image || !composeService) return { ok: true };

  onLog(`[${service}] pulling ${cfg.image}…`);
  const r = await runComposePull(args, composeService);
  for (const line of `${r.stdout}\n${r.stderr}`.split('\n')) {
    if (line.trim()) onLog(`[${service}] ${line.trim()}`);
  }
  if (r.code === 0) return { ok: true };

  // Registry down or credential expired. A gate that can already run must not
  // be taken down for this — fall back to the local image, loudly.
  if (await hasLocalImage(cfg.image)) {
    const warn = `pull failed (${r.stderr.trim() || `exit ${r.code}`}); starting with the local image`;
    onLog(`[${service}] WARN ${warn}`);
    return { ok: true, warn };
  }
  return { ok: false };
}

export async function imageStatuses(db: Database.Database): Promise<ImageStatus[]> {
  const project = getProjectPath(db);
  const out: ImageStatus[] = [];
  for (const service of ['ipcame', 'rfid'] as const) {
    const cfg = imageConfig(db, service);
    const base = baseImageFrom(project, service);
    let composeService: string | null = null;
    let error: string | null = null;
    try {
      composeService = composeServiceFor(db, service);
      if (!composeService) error = 'Could not detect the compose service in the file.';
    } catch (err) {
      error = (err as Error).message;
    }
    // A configured image over an ambiguous file is the case the settings card
    // must surface inline rather than failing at start time.
    if (cfg.image && !composeService) {
      error = `Cannot apply the configured image: ${error ?? 'compose service could not be detected'}`;
    }
    const effectiveImage = resolveImage(db, service, base);
    out.push({
      service,
      image: cfg.image,
      effectiveImage,
      policy: cfg.policy,
      composeFile: composeFileFor(service),
      composeService,
      localDigest: effectiveImage && (await hasLocalImage(effectiveImage)) ? effectiveImage : null,
      error
    });
  }
  return out;
}

export { overridePath };
