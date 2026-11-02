import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? filesIn(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]))).flat();
}
const files = [...await filesIn('src'), ...await filesIn('scripts'), ...await filesIn('tests'), 'vite.config.js', 'playwright.config.js'].filter((file) => /\.[cm]?js$/.test(file));
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Sintaxis correcta en ${files.length} archivos JavaScript.`);
