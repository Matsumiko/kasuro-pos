/* global URL, console */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const assetsDir = new URL('../apps/web/dist/assets/', import.meta.url);
const files = await readdir(assetsDir);
const bundles = files.filter((file) => file.endsWith('.js'));
const source = (
  await Promise.all(bundles.map((file) => readFile(join(assetsDir.pathname, file), 'utf8')))
).join('\n');
if (source.includes('http://localhost:8787')) {
  throw new Error('Production web bundle still points to the local API origin');
}
console.log('Production web bundle uses same-origin API routing');
