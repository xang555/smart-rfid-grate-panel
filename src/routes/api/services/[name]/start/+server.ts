import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { startOne } from '$lib/server/services/manager';
import { SERVICE_ORDER, type ServiceName } from '$lib/server/services/types';

export const POST: RequestHandler = async ({ params, request }) => {
  const name = params.name as ServiceName;
  if (!SERVICE_ORDER.includes(name)) {
    return json({ ok: false, message: `Unknown service: ${name}` }, { status: 400 });
  }
  const body = await request.json().catch(() => ({}));
  const result = await startOne(getDb(), name, { force: body?.force === true });
  if (!result.ok && result.code === 'dependency_down') return json(result, { status: 409 });
  return json(result);
};
