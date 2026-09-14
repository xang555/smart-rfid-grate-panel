import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import {
  imageStatuses, setImageConfig, validateImageRef, pull, prepareCompose,
  type DockerService, type PullPolicy
} from '$lib/server/images';

const SERVICES: DockerService[] = ['ipcame', 'rfid'];
const POLICIES: PullPolicy[] = ['always', 'never'];

export const GET: RequestHandler = async () => {
  return json({ images: await imageStatuses(getDb()) });
};

export const PUT: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const service = body?.service as DockerService;
  if (!SERVICES.includes(service)) {
    return json({ ok: false, message: 'Unknown service' }, { status: 400 });
  }
  const db = getDb();

  const patch: { image?: string; policy?: PullPolicy } = {};
  if (body?.image !== undefined) {
    const image = String(body.image);
    if (image) {
      const check = validateImageRef(image);
      if (!check.ok) return json({ ok: false, message: check.message }, { status: 400 });
    }
    patch.image = image;
  }
  if (body?.policy !== undefined) {
    if (!POLICIES.includes(body.policy)) {
      return json({ ok: false, message: 'Policy must be "always" or "never".' }, { status: 400 });
    }
    patch.policy = body.policy;
  }
  const cfg = setImageConfig(db, service, patch);

  // A configured image over a multi-service compose file cannot be applied;
  // surface that now instead of failing at start time.
  let error: string | null = null;
  if (cfg.image) {
    try {
      await prepareCompose(db, service);
    } catch (err: any) {
      if (err?.code === 'ambiguous_compose_service') {
        return json(
          { ok: false, code: err.code, found: err.found ?? [], message: err.message },
          { status: 409 }
        );
      }
      error = String(err?.message ?? err);
    }
  }

  const statuses = await imageStatuses(db);
  const status = statuses.find((s) => s.service === service)!;
  return json({ ok: !error, image: { ...status, error: error ?? status.error } });
};

export const POST: RequestHandler = async ({ url }) => {
  const service = url.searchParams.get('service') as DockerService | null;
  if (!service || !SERVICES.includes(service)) {
    return json({ ok: false, message: 'Unknown service' }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        const result = await pull(getDb(), service, (line) => send({ type: 'line', line }));
        send({ type: 'result', result });
      } catch (err: any) {
        send({ type: 'result', result: { ok: false, message: String(err?.message ?? err) } });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' }
  });
};
