import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { getProjectPath, checkLayout, getConfig } from '$lib/server/settings';

export const load: PageServerLoad = async () => {
  const db = getDb();
  const projectPath = getProjectPath(db);
  return {
    projectPath,
    installed: checkLayout(projectPath).ok,
    savedDockerUser: getConfig(db, 'docker_user') ?? ''
  };
};
