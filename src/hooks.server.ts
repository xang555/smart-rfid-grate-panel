import type { Handle } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { hasPin, validateSession, cleanupExpired } from '$lib/server/auth';
import { newRequestId, logError } from '$lib/server/log';

const PUBLIC_PREFIXES = ['/api/auth/', '/_app/', '/favicon', '/robots.txt'];

export const handle: Handle = async ({ event, resolve }) => {
  const db = getDb();
  event.locals.ip = event.getClientAddress();
  event.locals.requestId = newRequestId();

  const sid = event.cookies.get('sid');
  event.locals.session = sid && validateSession(db, sid).valid ? { id: sid } : null;

  const path = event.url.pathname;
  const isPublic = PUBLIC_PREFIXES.some((p) => path.startsWith(p));
  const pinned = hasPin(db);

  // Route gating (spec 7.1): no PIN → only /setup-pin; PIN without a session →
  // only /login; signed in → auth screens bounce to the control screen.
  let redirectTo: string | null = null;
  if (!isPublic) {
    if (!pinned && path !== '/setup-pin') redirectTo = '/setup-pin';
    else if (pinned && !event.locals.session && path !== '/login') redirectTo = '/login';
    else if (pinned && event.locals.session && (path === '/login' || path === '/setup-pin')) {
      redirectTo = '/';
    }
  }
  if (redirectTo) {
    return new Response(null, { status: 303, headers: { location: redirectTo } });
  }

  if (Math.random() < 0.01) cleanupExpired(db);

  try {
    return await resolve(event);
  } catch (err: any) {
    if (err?.status === 303 || err?.status === 302) throw err;
    logError('unhandled request error', { requestId: event.locals.requestId, path });
    throw err;
  }
};
