import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const DEFAULT_DATA = {
  users: [],
  sessions: [],
};

let writeQueue = Promise.resolve();

export async function ensureStore(filePath) {
  await mkdir(dirname(filePath), { recursive: true });

  try {
    await readFile(filePath, 'utf8');
  } catch {
    await writeFile(filePath, JSON.stringify(DEFAULT_DATA, null, 2), 'utf8');
  }
}

export async function readStore(filePath) {
  await ensureStore(filePath);
  const raw = await readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw || '{}');

  return {
    ...DEFAULT_DATA,
    ...parsed,
    users: Array.isArray(parsed.users) ? parsed.users : [],
    sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
  };
}

export async function updateStore(filePath, updater) {
  writeQueue = writeQueue.then(async () => {
    const current = await readStore(filePath);
    const next = await updater(structuredClone(current));
    await writeFile(filePath, JSON.stringify(next, null, 2), 'utf8');
    return next;
  });

  return writeQueue;
}
