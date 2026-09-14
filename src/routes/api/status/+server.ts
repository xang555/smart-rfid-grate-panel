import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { status } from '$lib/server/services/manager';

export const GET: RequestHandler = async () => {
  return json({ services: status(getDb()) });
};
