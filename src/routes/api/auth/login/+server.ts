import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { verifyPin, createSession } from '$lib/server/auth';
import { pushLog } from '$lib/server/services/logbus';

export const POST: RequestHandler = async ({ request, cookies, locals }) => {
  const db = getDb();
  const body = await request.json().catch(() => ({}));
  const pin = String(body.pin ?? '');
  const res = verifyPin(db, pin, locals.ip);

  if (!res.ok) {
    if (res.code === 'locked') {
      pushLog({ service: 'auth', level: 'warn', message: `Login blocked for ${locals.ip}` });
      return json({ ok: false, code: 'locked', retryAfterMs: res.retryAfterMs },
        { status: 423 });
    }
    pushLog({ service: 'auth', level: 'warn', message: `Failed login from ${locals.ip}` });
    if (res.code === 'no_pin') return json({ ok: false, code: 'no_pin' }, { status: 400 });
    return json({ ok: false, code: 'bad_pin' }, { status: 401 });
  }

  const { id } = createSession(db);
  cookies.set('sid', id, {
    path: '/', httpOnly: true, sameSite: 'strict',
    secure: new URL(request.url).protocol === 'https:',
    maxAge: 12 * 60 * 60
  });
  pushLog({ service: 'auth', level: 'system', message: 'Signed in' });
  return json({ ok: true });
};
