import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * True when a file was started directly (for example `node src/collect/collectCrops.js`),
 * false when another file or a test imported it.
 *
 * Usage inside a script:  if (isRunDirectly(import.meta.url)) main();
 */
export function isRunDirectly(moduleUrl) {
  if (!process.argv[1]) return false;
  return path.resolve(fileURLToPath(moduleUrl)) === path.resolve(process.argv[1]);
}
