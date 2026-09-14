import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { hasPin } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals }) => {
  const db = getDb();
  if (!hasPin(db)) throw redirect(303, '/setup-pin');
  if (locals.session) throw redirect(303, '/');
  return {};
};
