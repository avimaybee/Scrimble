import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface DetectedStack {
  languages: string[];
  frameworks: string[];
  packageManager?: string;
}

interface PackageJsonShape {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export async function detectStack(cwd: string): Promise<DetectedStack> {
  const languages: string[] = [];
  const frameworks: string[] = [];
  let packageManager: string | undefined;

  const fileList = await fs.readdir(cwd).catch(() => [] as string[]);
  const files = new Set(fileList);

  if (files.has('package.json')) {
    languages.push('TypeScript/JavaScript');

    try {
      const pkgContent = await fs.readFile(path.join(cwd, 'package.json'), 'utf-8');
      const pkg = JSON.parse(pkgContent) as PackageJsonShape;

      if (files.has('pnpm-lock.yaml')) packageManager = 'pnpm';
      else if (files.has('yarn.lock')) packageManager = 'yarn';
      else if (files.has('package-lock.json')) packageManager = 'npm';
      else if (files.has('bun.lockb')) packageManager = 'bun';

      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (allDeps['next']) frameworks.push('Next.js');
      if (allDeps['react']) frameworks.push('React');
      if (allDeps['vue']) frameworks.push('Vue');
      if (allDeps['svelte']) frameworks.push('Svelte');
      if (allDeps['express']) frameworks.push('Express');
      if (allDeps['hono']) frameworks.push('Hono');
      if (allDeps['fastify']) frameworks.push('Fastify');
      if (allDeps['@cloudflare/workers-types']) frameworks.push('Cloudflare Workers');
    } catch {
      // Ignore malformed package.json.
    }
  }

  if (files.has('requirements.txt') || files.has('pyproject.toml') || files.has('setup.py')) {
    languages.push('Python');
  }
  if (files.has('go.mod')) {
    languages.push('Go');
  }
  if (files.has('Cargo.toml')) {
    languages.push('Rust');
  }
  if (files.has('Gemfile')) {
    languages.push('Ruby');
  }

  return {
    languages,
    frameworks,
    ...(packageManager ? { packageManager } : {}),
  };
}
