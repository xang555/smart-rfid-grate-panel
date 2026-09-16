import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { getConfig, setConfig } from '$lib/server/settings';

function validUrl(url: string): boolean {
  if (url === '') return true;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export const GET: RequestHandler = async () => {
  const db = getDb();
  return json({ url: getConfig(db, 'monitor_url') ?? '' });
};

export const PUT: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null);
  const url = typeof body?.url === 'string' ? body.url.trim() : null;
  if (url === null) return json({ message: 'url must be a string' }, { status: 400 });
  if (!validUrl(url)) return json({ message: 'must be an http(s) URL' }, { status: 400 });

  const db = getDb();
  if (url === '') {
    db.prepare('DELETE FROM app_config WHERE key = ?').run('monitor_url');
  } else {
    setConfig(db, 'monitor_url', url);
  }
  return json({ url });
};
