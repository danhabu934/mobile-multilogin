import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');
await fs.rm(out, {recursive: true, force: true});
await fs.cp(path.join(root, 'landing'), out, {recursive: true});
console.log('Site built: distribution/dist. No unavailable installer links were generated.');
