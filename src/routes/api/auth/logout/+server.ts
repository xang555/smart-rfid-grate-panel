import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { destroySession } from '$lib/server/auth';
import { pushLog } from '$lib/server/services/logbus';

export const POST: RequestHandler = async ({ cookies }) => {
  const sid = cookies.get('sid');
  if (sid) {
    destroySession(getDb(), sid);
    cookies.delete('sid', { path: '/' });
  }
  pushLog({ service: 'auth', level: 'system', message: 'Signed out' });
  return json({ ok: true });
};
