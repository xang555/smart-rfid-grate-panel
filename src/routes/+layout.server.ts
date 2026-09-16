import type { LayoutServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { hasPin } from '$lib/server/auth';
import { isInstalled } from '$lib/server/setup';
import { getConfig } from '$lib/server/settings';

export const load: LayoutServerLoad = async ({ locals }) => {
  const db = getDb();
  return {
    sessionActive: !!locals.session,
    hasPin: hasPin(db),
    installed: isInstalled(db),
    monitorUrl: getConfig(db, 'monitor_url') ?? ''
  };
};
