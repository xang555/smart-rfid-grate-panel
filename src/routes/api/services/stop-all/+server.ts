import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { stopAll } from '$lib/server/services/manager';

export const POST: RequestHandler = async () => {
  return json({ results: await stopAll(getDb()) });
};
