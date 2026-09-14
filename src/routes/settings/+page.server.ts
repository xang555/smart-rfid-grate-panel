import fs from 'node:fs';
import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { getProjectPath, resolveProjectFile } from '$lib/server/settings';
import { SCHEMAS, CONFIG_FILES } from '$lib/server/config/schema';
import { readConfig } from '$lib/server/config/store';

export const load: PageServerLoad = async () => {
  const db = getDb();
  const projectPath = getProjectPath(db);
  const files = CONFIG_FILES.map((key) => {
    const schema = SCHEMAS[key];
    const filePath = resolveProjectFile(projectPath, schema.relPath);
    let raw = '';
    try { raw = fs.readFileSync(filePath, 'utf8'); } catch { raw = ''; }
    return { key, schema, value: readConfig(filePath, schema), rawToml: raw, exists: !!raw };
  });
  return { files, projectPath };
};
