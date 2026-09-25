import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const dirs = ['diagnostics', 'launcher', 'scripts', 'test', 'landing'];
let count = 0;
for (const dir of dirs) {
  for (const name of await fs.readdir(dir, {recursive: true})) {
    if (!/\.(cjs|mjs|js)$/.test(name)) continue;
    execFileSync(process.execPath, ['--check', `${dir}/${name}`], {stdio: 'inherit'});
    count++;
  }
}
console.log(`Syntax validation passed for ${count} JavaScript files. This is not ESLint.`);
