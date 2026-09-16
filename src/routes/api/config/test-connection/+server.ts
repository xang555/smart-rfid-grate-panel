import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { probePort } from '$lib/server/proc/reader';
import type { ConnResult, ConnTarget } from '$lib/connection-logic';

const MAX_TARGETS = 16;
const TIMEOUT_MS = 3000;

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null);
  const targets: ConnTarget[] = body?.targets;
  if (!Array.isArray(targets) || targets.length === 0 || targets.length > MAX_TARGETS) {
    return json({ message: `targets must be a list of 1–${MAX_TARGETS}` }, { status: 400 });
  }

  const results: ConnResult[] = [];
  for (const t of targets) {
    const base = { label: String(t?.label ?? ''), host: String(t?.host ?? ''), port: Number(t?.port) };
    const host = base.host.trim();
    const port = base.port;
    if (!host) {
      results.push({ ...base, host, ok: false, error: 'no host configured' });
      continue;
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      results.push({ ...base, host, ok: false, error: `invalid port: ${String(t?.port)}` });
      continue;
    }
    const started = Date.now();
    try {
      const ok = await probePort(host, port, TIMEOUT_MS);
      // probePort resolves false on timeout/error without a reason; only a
      // connect resolves true.
      if (ok) {
        results.push({ ...base, host, ok: true, ms: Date.now() - started });
      } else {
        results.push({ ...base, host, ok: false, error: `no connection within ${TIMEOUT_MS}ms` });
      }
    } catch (err: any) {
      results.push({ ...base, host, ok: false, error: String(err?.code ?? err?.message ?? err) });
    }
  }
  return json({ results });
};
