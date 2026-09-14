import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { stopOne } from '$lib/server/services/manager';
import { SERVICE_ORDER, type ServiceName } from '$lib/server/services/types';

export const POST: RequestHandler = async ({ params }) => {
  const name = params.name as ServiceName;
  if (!SERVICE_ORDER.includes(name)) {
    return json({ ok: false, message: `Unknown service: ${name}` }, { status: 400 });
  }
  return json(await stopOne(getDb(), name));
};
