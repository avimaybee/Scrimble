#!/usr/bin/env node

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST_EXTENSIONS = ['.js', '.js.map', '.d.ts', '.d.ts.map'];
const checkOnly = process.argv.includes('--check');

function toPosixPath(targetPath) {
  return targetPath.split(path.sep).join('/');
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(rootDir) {
  const collected = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
      } else if (entry.isFile()) {
        const relative = path.relative(rootDir, absolute);
        collected.push({
          absolute,
          relative: toPosixPath(relative),
        });
      }
    }
  }
  return collected;
}

async function removeEmptyDirectories(rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const child = path.join(rootDir, entry.name);
    await removeEmptyDirectories(child);
    const childEntries = await fs.readdir(child);
    if (childEntries.length === 0) {
      await fs.rm(child, { recursive: false, force: true });
    }
  }
}

function isSourceCommandFile(relativePath) {
  return (
    relativePath.endsWith('.ts') &&
    !relativePath.endsWith('.d.ts') &&
    !relativePath.endsWith('.test.ts') &&
    !relativePath.endsWith('.spec.ts')
  );
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const cliDir = path.resolve(scriptDir, '..');
  const srcCommandsDir = path.join(cliDir, 'src', 'commands');
  const distCommandsDir = path.join(cliDir, 'dist', 'commands');

  if (!(await pathExists(srcCommandsDir)) || !(await pathExists(distCommandsDir))) {
    return;
  }

  const sourceFiles = await listFiles(srcCommandsDir);
  const commandRoots = sourceFiles
    .map((file) => file.relative)
    .filter(isSourceCommandFile)
    .map((file) => file.slice(0, -'.ts'.length));

  const allowedDistFiles = new Set();
  for (const root of commandRoots) {
    for (const extension of DIST_EXTENSIONS) {
      allowedDistFiles.add(`${root}${extension}`);
    }
  }

  const distFiles = await listFiles(distCommandsDir);
  const staleFiles = distFiles.filter((file) => !allowedDistFiles.has(file.relative));

  if (checkOnly) {
    if (staleFiles.length > 0) {
      console.error('Found stale compiled command artifacts:');
      for (const file of staleFiles) {
        console.error(`- ${file.relative}`);
      }
      process.exitCode = 1;
    }
    return;
  }

  for (const file of staleFiles) {
    await fs.rm(file.absolute, { force: true });
  }
  await removeEmptyDirectories(distCommandsDir);
}

await main();
