import { execFile as execFileCallback } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const RUNNER_PATH = path.resolve(process.cwd(), 'extractor', 'runner.py');
const VENV_PYTHON = path.resolve(process.cwd(), '.venv', 'bin', 'python');

async function getPythonExecutable() {
  try {
    await access(VENV_PYTHON);
    return VENV_PYTHON;
  } catch {
    return 'python3';
  }
}

export async function runBookletExtractor({ testId, pdfPath, testDir, title, examType, bookletType }) {
  const python = await getPythonExecutable();
  const { stdout } = await execFile(python, [
    RUNNER_PATH,
    'extract',
    '--test-id', String(testId),
    '--pdf', pdfPath,
    '--test-dir', testDir,
    '--title', String(title || ''),
    '--exam-type', String(examType || ''),
    '--booklet-type', String(bookletType || ''),
  ], { timeout: 180000, maxBuffer: 20 * 1024 * 1024 });

  return JSON.parse(stdout);
}

export async function regenerateBookletCrop({ pdfPath, testDir, pageNumber, crop, outputRelativePath }) {
  const python = await getPythonExecutable();
  const { stdout } = await execFile(python, [
    RUNNER_PATH,
    'crop',
    '--pdf', pdfPath,
    '--test-dir', testDir,
    '--page', String(pageNumber),
    '--x', String(crop.x),
    '--y', String(crop.y),
    '--width', String(crop.width),
    '--height', String(crop.height),
    '--output', String(outputRelativePath),
  ], { timeout: 120000, maxBuffer: 8 * 1024 * 1024 });

  return JSON.parse(stdout);
}
