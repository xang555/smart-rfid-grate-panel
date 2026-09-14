import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { runSetup, isZipUrl } from '$lib/server/setup';

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const dockerUser = String(body?.dockerUser ?? '');
  const dockerPassword = String(body?.dockerPassword ?? '');
  if (!dockerUser || !dockerPassword) {
    return json({ ok: false, message: 'Docker username and password are required' }, { status: 400 });
  }
  const zipUrl = String(body?.zipUrl ?? '');
  if (!zipUrl) {
    return json({ ok: false, message: 'Download URL is required' }, { status: 400 });
  }
  if (!isZipUrl(zipUrl)) {
    return json({ ok: false, message: 'Download URL must be an http or https link' }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        const result = await runSetup({
          db: getDb(), dockerUser, dockerPassword, zipUrl,
          projectPath: body?.projectPath,
          onLine: (line) => send({ type: 'line', line }),
          onStep: (step, status) => send({ type: 'step', step, status })
        });
        send({ type: 'result', result });
      } catch (err: any) {
        send({ type: 'result', result: { ok: false, message: 'Setup crashed', detail: String(err?.message ?? err) } });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' }
  });
};
