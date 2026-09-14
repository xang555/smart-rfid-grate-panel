import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { createPin, hasPin, createSession } from '$lib/server/auth';
import { pushLog } from '$lib/server/services/logbus';

export const POST: RequestHandler = async ({ request, cookies }) => {
  const db = getDb();
  const body = await request.json().catch(() => ({}));
  const pin = String(body.pin ?? '');
  if (hasPin(db)) throw error(409, 'A PIN already exists');
  try {
    createPin(db, pin);
  } catch (err: any) {
    if (err?.message === 'bad_pin') throw error(400, 'PIN must be exactly 6 digits');
    throw error(500, 'Could not create PIN');
  }
  const { id } = createSession(db);
  cookies.set('sid', id, {
    path: '/', httpOnly: true, sameSite: 'strict',
    secure: new URL(request.url).protocol === 'https:',
    maxAge: 12 * 60 * 60
  });
  pushLog({ service: 'auth', level: 'system', message: 'Panel PIN created' });
  return json({ ok: true });
};
