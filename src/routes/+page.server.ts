import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { status } from '$lib/server/services/manager';
import { getProjectPath, checkLayout } from '$lib/server/settings';

export const load: PageServerLoad = async () => {
  const db = getDb();
  const projectPath = getProjectPath(db);
  return {
    services: status(db),
    projectPath,
    installed: checkLayout(projectPath).ok
  };
};
