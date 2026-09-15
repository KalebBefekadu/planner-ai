import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const scriptPath = fileURLToPath(
  new URL('../../scripts/with-local-supabase-lock.sh', import.meta.url)
);

const temporaryRoots: string[] = [];

type CommandResult = {
  code: number | null;
  stderr: string;
  stdout: string;
};

function runWithLock(lockDirectory: string, command: string[]) {
  const child = spawn('bash', [scriptPath, ...command], {
    cwd: path.dirname(scriptPath),
    env: {
      ...process.env,
      PLANNER_SUPABASE_LOCK_DIR: lockDirectory,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

  const result = new Promise<CommandResult>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });

  return { child, result };
}

async function makeLockDirectory() {
  const root = await mkdtemp(path.join(tmpdir(), 'planner-ai-supabase-lock-'));
  temporaryRoots.push(root);
  return path.join(root, 'lock');
}

async function waitForFile(filePath: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await access(filePath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

async function fileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, {
        recursive: true,
        force: true,
      })
    )
  );
});

describe('local Supabase lock', () => {
  it('propagates the command result and releases the lock', async () => {
    const lockDirectory = await makeLockDirectory();

    const success = await runWithLock(lockDirectory, ['bash', '-c', 'printf ready']).result;
    expect(success).toMatchObject({ code: 0, stdout: 'ready' });
    expect(await fileExists(lockDirectory)).toBe(false);

    const failure = await runWithLock(lockDirectory, ['bash', '-c', 'exit 23']).result;
    expect(failure.code).toBe(23);
    expect(await fileExists(lockDirectory)).toBe(false);
  });

  it('rejects a second owner with actionable diagnostics', async () => {
    const lockDirectory = await makeLockDirectory();
    const holder = runWithLock(lockDirectory, [
      process.execPath,
      '-e',
      'setTimeout(() => {}, 1000)',
    ]);

    await waitForFile(path.join(lockDirectory, 'owner'));
    const owner = await readFile(path.join(lockDirectory, 'owner'), 'utf8');
    expect(owner).toContain('pid=');
    expect(owner).toContain('branch=');
    expect(owner).toContain('worktree=');

    const contender = await runWithLock(lockDirectory, ['bash', '-c', 'exit 0']).result;
    expect(contender.code).toBe(75);
    expect(contender.stderr).toContain('shared Planner AI Supabase stack is already reserved');
    expect(contender.stderr).toContain('Current owner:');
    expect(contender.stderr).toContain(`Lock: ${lockDirectory}`);

    expect((await holder.result).code).toBe(0);
    expect(await fileExists(lockDirectory)).toBe(false);
  });
});
