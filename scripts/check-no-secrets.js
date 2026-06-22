import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const ignored = new Set(['.git', '.vercel', 'node_modules', 'dist', 'coverage']);
const secretPatterns = [
  /AIza[0-9A-Za-z_-]{20,}/g,
  /GEMINI_API_KEY\s*=\s*["'][^"']+["']/g,
  /apiKey\s*:\s*["']AIza[0-9A-Za-z_-]{20,}["']/g,
];

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignored.has(entry.name)) {
      continue;
    }

    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(path));
    } else {
      files.push(path);
    }
  }
  return files;
}

let failed = false;
for (const file of await listFiles(root)) {
  const text = await readFile(file, 'utf8').catch(() => '');
  for (const pattern of secretPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      console.error(`Secret-like value found in ${file}`);
      failed = true;
    }
  }
}

if (failed) {
  process.exit(1);
}

console.log('No API keys or secret-like values found.');
