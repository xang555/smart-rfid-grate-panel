import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { startAll } from '$lib/server/services/manager';

export const POST: RequestHandler = async () => {
  return json({ results: await startAll(getDb()) });
};
