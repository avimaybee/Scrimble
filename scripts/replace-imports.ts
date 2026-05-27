import { readFileSync, writeFileSync } from 'fs';
import { globSync } from 'glob';

const coreModules = [
  'generation-schemas',
  'generation-pipeline',
  'ai',
  'checkpoint-storage',
  'generation-events',
  'generation-runtime',
  'mcp-servers',
  'project-briefs',
  'research-facade',
  'research-manifest',
  'research-query-policy',
  'research',
  'step-research',
  'user-tools',
  'types',
];

const files = globSync('/app/functions/server/**/*.ts');
files.push(...globSync('/app/scripts/**/*.ts'));
files.push('/app/worker-consumer.ts');
files.push('/app/workers/tools/index.ts');

for (const file of files) {
  let content = readFileSync(file, 'utf8');
  let changed = false;

  for (const mod of coreModules) {
    const regexps = [
      new RegExp(`from '\\./${mod}'`, 'g'),
      new RegExp(`from '\\.\\./server/${mod}'`, 'g'),
      new RegExp(`from '\\.\\./\\.\\./functions/server/${mod}'`, 'g'),
      new RegExp(`from '\\.\\./${mod}'`, 'g'),
    ];

    for (const rx of regexps) {
      if (rx.test(content)) {
        content = content.replace(rx, `from '@scrimble/core'`);
        changed = true;
      }
    }
  }

  if (changed) {
    writeFileSync(file, content);
  }
}
