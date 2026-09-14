import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { hasPin } from '$lib/server/auth';

export const load: PageServerLoad = async () => {
  if (hasPin(getDb())) throw redirect(303, '/login');
  return {};
};
