import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const STORAGE_ROOT = path.resolve(process.cwd(), 'storage', 'tests');

export function getBookletStorageRoot() {
  return STORAGE_ROOT;
}

export function getTestDir(testId) {
  return path.join(STORAGE_ROOT, String(testId));
}

export function getOriginalPdfPath(testId) {
  return path.join(getTestDir(testId), 'original.pdf');
}

export function getPagesDir(testId) {
  return path.join(getTestDir(testId), 'pages');
}

export function getCropsDir(testId) {
  return path.join(getTestDir(testId), 'crops');
}

export function getReviewPath(testId) {
  return path.join(getTestDir(testId), 'review.json');
}

export async function ensureTestStorage(testId) {
  const testDir = getTestDir(testId);
  await mkdir(testDir, { recursive: true });
  await mkdir(getPagesDir(testId), { recursive: true });
  await mkdir(getCropsDir(testId), { recursive: true });
  return testDir;
}

export async function writeReview(testId, review) {
  await ensureTestStorage(testId);
  await writeFile(getReviewPath(testId), JSON.stringify(review, null, 2), 'utf8');
}

export async function readReview(testId) {
  const raw = await readFile(getReviewPath(testId), 'utf8');
  return JSON.parse(raw);
}

export function toAssetUrl(testId, relativePath) {
  const safe = String(relativePath || '').replaceAll('\\', '/').replace(/^\/+/, '');
  return '/api/admin/booklet-tests/' + encodeURIComponent(testId) + '/assets/' + safe;
}
