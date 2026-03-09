export const TOOL_PROFICIENCIES = ['learning', 'comfortable', 'expert'] as const;
export type ToolProficiency = (typeof TOOL_PROFICIENCIES)[number];

export const BUILDER_PROFILE_CATEGORIES = [
  {
    key: 'coding_environment',
    label: 'Coding environment',
    presets: ['Cursor', 'Windsurf', 'VS Code', 'Claude Code', 'Zed', 'Neovim'],
  },
  {
    key: 'ai_assistants',
    label: 'AI assistants',
    presets: ['Claude', 'ChatGPT', 'Gemini', 'Grok', 'Perplexity', 'v0', 'Bolt', 'Lovable'],
  },
  {
    key: 'frontend',
    label: 'Frontend',
    presets: ['Next.js', 'React', 'Vue', 'Svelte', 'Astro', 'Remix'],
  },
  {
    key: 'backend_hosting',
    label: 'Backend & hosting',
    presets: ['Vercel', 'Railway', 'Fly.io', 'Cloudflare Workers', 'Render', 'Supabase', 'AWS', 'Hono', 'Express'],
  },
  {
    key: 'database',
    label: 'Database',
    presets: ['Supabase', 'Neon', 'Turso', 'PlanetScale', 'MongoDB', 'Firebase', 'Cloudflare D1', 'Prisma'],
  },
  {
    key: 'auth',
    label: 'Auth',
    presets: ['Clerk', 'Auth.js', 'Supabase Auth', 'Firebase Auth', 'Lucia', 'Better Auth'],
  },
  {
    key: 'payments',
    label: 'Payments',
    presets: ['Stripe', 'Lemon Squeezy', 'Paddle'],
  },
  {
    key: 'other_subscriptions',
    label: 'Other subscriptions',
    presets: [],
  },
] as const;

export type BuilderProfileCategory = (typeof BUILDER_PROFILE_CATEGORIES)[number]['key'];
export const BUILDER_PROFILE_CATEGORY_KEYS = BUILDER_PROFILE_CATEGORIES.map(
  (category) => category.key,
) as [
  BuilderProfileCategory,
  ...BuilderProfileCategory[],
];

export type BuilderProfileTool = {
  id: string;
  user_id: string;
  category: BuilderProfileCategory;
  name: string;
  proficiency: ToolProficiency;
  notes: string | null;
  created_at: string;
};

export type BuilderProfileCompletionLevel = 'Basic' | 'Good' | 'Dialled in' | 'Fully loaded';

type ToolMetadata = {
  reaction: string;
  docsTopic?: string;
  docsUrl?: string;
  changelogUrl?: string;
  github?: { owner: string; repo: string };
};

const TOOL_METADATA = new Map<string, ToolMetadata>([
  ['cursor', { reaction: "I'll write all coding prompts specifically for Cursor's composer.", docsTopic: 'composer, agents, project rules', docsUrl: 'https://docs.cursor.com', changelogUrl: 'https://www.cursor.com/changelog' }],
  ['windsurf', { reaction: "I'll frame coding prompts around Windsurf's Cascade workflow and handoffs.", docsTopic: 'cascade, memories, workflows', docsUrl: 'https://docs.windsurf.com', changelogUrl: 'https://windsurf.com/changelog' }],
  ['vs code', { reaction: "I'll keep instructions aligned with VS Code and GitHub Copilot chat conventions.", docsTopic: 'tasks, settings, terminals, extensions', docsUrl: 'https://code.visualstudio.com/docs', changelogUrl: 'https://code.visualstudio.com/updates' }],
  ['claude code', { reaction: "I'll shape terminal-first prompts the way Claude Code sessions actually unfold.", docsTopic: 'cli, projects, workflows', docsUrl: 'https://docs.anthropic.com', changelogUrl: 'https://www.anthropic.com/news' }],
  ['zed', { reaction: "I'll keep editor guidance tuned to Zed's workspace and assistant flow.", docsTopic: 'assistant, workspaces, extensions', docsUrl: 'https://zed.dev/docs', changelogUrl: 'https://zed.dev/releases' }],
  ['neovim', { reaction: "I'll keep implementation notes terse and terminal-friendly for a Neovim workflow.", docsTopic: 'editor workflow, plugins, terminal commands', docsUrl: 'https://neovim.io/doc', changelogUrl: 'https://github.com/neovim/neovim/releases', github: { owner: 'neovim', repo: 'neovim' } }],
  ['claude', { reaction: "I'll assume Claude is in your loop when I suggest reviews, rewrites, or second passes." }],
  ['chatgpt', { reaction: "I'll leave room for quick ChatGPT check-ins when a task benefits from a fast second opinion." }],
  ['gemini', { reaction: "I'll factor Gemini into side research and quick draft loops where it helps." }],
  ['grok', { reaction: "I'll treat Grok as part of your wider idea-testing toolkit when I suggest iteration loops." }],
  ['perplexity', { reaction: "I'll assume you can validate unknowns quickly with Perplexity when the plan needs outside confirmation." }],
  ['v0', { reaction: "UI steps will assume you can prototype interface directions quickly with v0." }],
  ['bolt', { reaction: "I'll assume Bolt is available when a fast prototype pass will help you unblock." }],
  ['lovable', { reaction: "I'll keep room for Lovable-style prototyping when it can shorten the path to a working draft." }],
  ['nextjs', { reaction: "Frontend steps will lean into Next.js routing, server patterns, and deployment ergonomics.", docsTopic: 'routing, app router, data fetching, deployment', docsUrl: 'https://nextjs.org/docs', changelogUrl: 'https://github.com/vercel/next.js/releases', github: { owner: 'vercel', repo: 'next.js' } }],
  ['react', { reaction: "Component architecture and state decisions will stay grounded in React patterns.", docsTopic: 'components, hooks, state, rendering', docsUrl: 'https://react.dev', changelogUrl: 'https://github.com/facebook/react/releases', github: { owner: 'facebook', repo: 'react' } }],
  ['vue', { reaction: "I'll frame frontend work around Vue's component and reactivity model.", docsTopic: 'components, composition api, reactivity', docsUrl: 'https://vuejs.org/guide', changelogUrl: 'https://github.com/vuejs/core/releases', github: { owner: 'vuejs', repo: 'core' } }],
  ['svelte', { reaction: "I'll keep UI guidance aligned with Svelte's compile-time patterns and conventions.", docsTopic: 'components, reactivity, stores', docsUrl: 'https://svelte.dev/docs', changelogUrl: 'https://github.com/sveltejs/svelte/releases', github: { owner: 'sveltejs', repo: 'svelte' } }],
  ['astro', { reaction: "I'll keep the frontend plan tuned to Astro's content and island model.", docsTopic: 'routing, content collections, islands, deployment', docsUrl: 'https://docs.astro.build', changelogUrl: 'https://github.com/withastro/astro/releases', github: { owner: 'withastro', repo: 'astro' } }],
  ['remix', { reaction: "I'll keep full-stack web guidance grounded in Remix loaders, actions, and routes.", docsTopic: 'routes, loaders, actions, deployment', docsUrl: 'https://remix.run/docs', changelogUrl: 'https://github.com/remix-run/remix/releases', github: { owner: 'remix-run', repo: 'remix' } }],
  ['vercel', { reaction: "Deployment steps will assume Vercel's project settings, previews, and environment variables.", docsTopic: 'deployment, environment variables, previews', docsUrl: 'https://vercel.com/docs', changelogUrl: 'https://github.com/vercel/vercel/releases', github: { owner: 'vercel', repo: 'vercel' } }],
  ['railway', { reaction: "Deployment steps will cover Railway's environment variables and health checks.", docsTopic: 'deployment, environment variables, health checks', docsUrl: 'https://docs.railway.com', changelogUrl: 'https://github.com/railwayapp/cli/releases', github: { owner: 'railwayapp', repo: 'cli' } }],
  ['flyio', { reaction: "Hosting notes will lean into Fly.io's regions, health checks, and app config.", docsTopic: 'deployment, fly.toml, health checks, regions', docsUrl: 'https://fly.io/docs', changelogUrl: 'https://github.com/superfly/flyctl/releases', github: { owner: 'superfly', repo: 'flyctl' } }],
  ['cloudflare workers', { reaction: "I'll keep backend guidance grounded in Cloudflare Workers bindings, queues, and edge constraints.", docsTopic: 'bindings, queues, deployment, runtime limits', docsUrl: 'https://developers.cloudflare.com/workers', changelogUrl: 'https://github.com/cloudflare/workers-sdk/releases', github: { owner: 'cloudflare', repo: 'workers-sdk' } }],
  ['render', { reaction: "Hosting steps will reflect Render's service settings, deploy hooks, and environment variable flow.", docsTopic: 'deployment, services, environment variables', docsUrl: 'https://render.com/docs' }],
  ['supabase', { reaction: "Database steps will use Supabase's table editor and RLS patterns.", docsTopic: 'database, auth, rls, migrations, edge functions', docsUrl: 'https://supabase.com/docs', changelogUrl: 'https://github.com/supabase/supabase/releases', github: { owner: 'supabase', repo: 'supabase' } }],
  ['aws', { reaction: "Infrastructure choices will assume you already have AWS in the mix, not a greenfield setup.", docsTopic: 'deployment, infrastructure, environments', docsUrl: 'https://docs.aws.amazon.com' }],
  ['hono', { reaction: "Backend steps will reference Hono routing, middleware, and request patterns directly.", docsTopic: 'routing, middleware, validation, deployment', docsUrl: 'https://hono.dev/docs', changelogUrl: 'https://github.com/honojs/hono/releases', github: { owner: 'honojs', repo: 'hono' } }],
  ['express', { reaction: "Server-side steps will stay specific to Express middleware and route composition.", docsTopic: 'routing, middleware, deployment', docsUrl: 'https://expressjs.com', changelogUrl: 'https://github.com/expressjs/express/releases', github: { owner: 'expressjs', repo: 'express' } }],
  ['neon', { reaction: "Database guidance will assume Neon branches, pooled connections, and Postgres workflows.", docsTopic: 'branches, connections, postgres setup', docsUrl: 'https://neon.tech/docs', changelogUrl: 'https://github.com/neondatabase/neon/releases', github: { owner: 'neondatabase', repo: 'neon' } }],
  ['turso', { reaction: "Database steps will stay specific to Turso databases, replicas, and libSQL workflows.", docsTopic: 'databases, replicas, libsql, deployment', docsUrl: 'https://docs.turso.tech', changelogUrl: 'https://github.com/tursodatabase/turso/releases', github: { owner: 'tursodatabase', repo: 'turso' } }],
  ['planetscale', { reaction: "Schema guidance will assume PlanetScale branching and deploy-request workflows.", docsTopic: 'schema changes, branches, deploy requests', docsUrl: 'https://planetscale.com/docs', changelogUrl: 'https://github.com/planetscale/cli/releases', github: { owner: 'planetscale', repo: 'cli' } }],
  ['mongodb', { reaction: "Persistence decisions will use MongoDB collections, indexes, and document tradeoffs.", docsTopic: 'collections, indexing, schema design', docsUrl: 'https://www.mongodb.com/docs', changelogUrl: 'https://github.com/mongodb/node-mongodb-native/releases', github: { owner: 'mongodb', repo: 'node-mongodb-native' } }],
  ['firebase', { reaction: "I'll assume Firebase is already familiar territory when auth or data storage comes up.", docsTopic: 'auth, firestore, hosting', docsUrl: 'https://firebase.google.com/docs', changelogUrl: 'https://firebase.google.com/support/release-notes/js', github: { owner: 'firebase', repo: 'firebase-js-sdk' } }],
  ['cloudflare d1', { reaction: "Database recommendations will stay specific to D1's SQLite model and Cloudflare bindings.", docsTopic: 'queries, migrations, bindings, limits', docsUrl: 'https://developers.cloudflare.com/d1', changelogUrl: 'https://developers.cloudflare.com/d1/platform/release-notes/' }],
  ['prisma', { reaction: "Database steps will include Prisma schema, migrations, and client generation details.", docsTopic: 'schema, migrations, client, postgres', docsUrl: 'https://www.prisma.io/docs', changelogUrl: 'https://github.com/prisma/prisma/releases', github: { owner: 'prisma', repo: 'prisma' } }],
  ['clerk', { reaction: "Auth steps will use Clerk's session, middleware, and onboarding primitives.", docsTopic: 'sessions, middleware, auth flows', docsUrl: 'https://clerk.com/docs', changelogUrl: 'https://github.com/clerk/javascript/releases', github: { owner: 'clerk', repo: 'javascript' } }],
  ['authjs', { reaction: "Auth guidance will stay specific to Auth.js providers, sessions, and callbacks.", docsTopic: 'providers, sessions, callbacks', docsUrl: 'https://authjs.dev', changelogUrl: 'https://github.com/nextauthjs/next-auth/releases', github: { owner: 'nextauthjs', repo: 'next-auth' } }],
  ['supabase auth', { reaction: "Sign-in and permission flows will follow Supabase Auth conventions instead of generic auth advice.", docsTopic: 'auth, providers, sessions, rls', docsUrl: 'https://supabase.com/docs/guides/auth', changelogUrl: 'https://github.com/supabase/auth/releases', github: { owner: 'supabase', repo: 'auth' } }],
  ['firebase auth', { reaction: "Auth work will use Firebase Auth terminology, SDK setup, and token flows.", docsTopic: 'auth, tokens, providers, sessions', docsUrl: 'https://firebase.google.com/docs/auth', changelogUrl: 'https://firebase.google.com/support/release-notes/js', github: { owner: 'firebase', repo: 'firebase-js-sdk' } }],
  ['lucia', { reaction: "Auth implementation notes will stay aligned with Lucia's session and adapter model.", docsTopic: 'sessions, adapters, auth', docsUrl: 'https://lucia-auth.com', changelogUrl: 'https://github.com/lucia-auth/lucia/releases', github: { owner: 'lucia-auth', repo: 'lucia' } }],
  ['better auth', { reaction: "Auth guidance will assume Better Auth's primitives and session model instead of generic auth middleware.", docsTopic: 'sessions, providers, auth setup', docsUrl: 'https://www.better-auth.com/docs', changelogUrl: 'https://github.com/better-auth/better-auth/releases', github: { owner: 'better-auth', repo: 'better-auth' } }],
  ['stripe', { reaction: "Payment steps will include Stripe webhook setup and test mode guidance.", docsTopic: 'checkout, webhooks, subscriptions, test mode', docsUrl: 'https://docs.stripe.com', changelogUrl: 'https://github.com/stripe/stripe-node/releases', github: { owner: 'stripe', repo: 'stripe-node' } }],
  ['lemon squeezy', { reaction: "Billing steps will stay specific to Lemon Squeezy's products, checkouts, and webhooks.", docsTopic: 'checkouts, subscriptions, webhooks', docsUrl: 'https://docs.lemonsqueezy.com', changelogUrl: 'https://github.com/lmsqueezy/lemonsqueezy.js/releases', github: { owner: 'lmsqueezy', repo: 'lemonsqueezy.js' } }],
  ['paddle', { reaction: "Payment guidance will follow Paddle's checkout, tax, and webhook flow.", docsTopic: 'checkout, billing, webhooks', docsUrl: 'https://developer.paddle.com', changelogUrl: 'https://github.com/PaddleHQ/paddle-node-sdk/releases', github: { owner: 'PaddleHQ', repo: 'paddle-node-sdk' } }],
]);

export function normalizeBuilderProfileName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ');
}

export function getBuilderProfileMetadata(name: string) {
  return TOOL_METADATA.get(normalizeBuilderProfileName(name)) || null;
}

export function getBuilderProfileReaction(name: string, category: BuilderProfileCategory) {
  const metadata = getBuilderProfileMetadata(name);
  if (metadata?.reaction) {
    return metadata.reaction;
  }

  switch (category) {
    case 'coding_environment':
      return `I'll tailor coding prompts to ${name}'s workflow instead of generic editor advice.`;
    case 'ai_assistants':
      return `I'll assume ${name} is available when a fast second opinion or prototype pass helps.`;
    case 'frontend':
      return `${name} will anchor frontend choices, examples, and implementation detail throughout the plan.`;
    case 'backend_hosting':
      return `${name} will shape backend and deployment steps instead of generic platform suggestions.`;
    case 'database':
      return `Database steps will stay specific to ${name}'s workflow and tradeoffs.`;
    case 'auth':
      return `Auth guidance will use ${name}'s actual primitives, flows, and gotchas.`;
    case 'payments':
      return `Billing steps will stay grounded in ${name}'s checkout and webhook flow.`;
    case 'other_subscriptions':
    default:
      return `I'll factor ${name} into the workflow wherever it can make the plan more specific.`;
  }
}

export function getBuilderProfileDocsTopic(category: BuilderProfileCategory, name: string) {
  const metadata = getBuilderProfileMetadata(name);
  if (metadata?.docsTopic) {
    return metadata.docsTopic;
  }

  switch (category) {
    case 'frontend':
      return 'getting started, routing, data fetching, best practices';
    case 'backend_hosting':
      return 'deployment, environment variables, health checks, production setup';
    case 'database':
      return 'schema design, setup, migrations, production gotchas';
    case 'auth':
      return 'authentication setup, sessions, providers, middleware';
    case 'payments':
      return 'checkout, subscriptions, webhooks, test mode';
    case 'coding_environment':
      return 'workflows, project rules, agent setup';
    case 'ai_assistants':
      return 'product docs, workflow';
    case 'other_subscriptions':
    default:
      return 'getting started';
  }
}

export function getBuilderProfileResearchUrls(name: string) {
  const metadata = getBuilderProfileMetadata(name);
  const githubUrl = metadata?.github
    ? `https://github.com/${metadata.github.owner}/${metadata.github.repo}`
    : '';
  const changelogUrl = metadata?.changelogUrl || (githubUrl ? `${githubUrl}/releases` : '');

  return {
    docsUrl: metadata?.docsUrl || '',
    changelogUrl,
    githubUrl,
    github: metadata?.github || null,
  };
}

export function isBuilderProfileResearchCategory(category: BuilderProfileCategory) {
  return (
    category === 'frontend' ||
    category === 'backend_hosting' ||
    category === 'database' ||
    category === 'auth' ||
    category === 'payments'
  );
}

export function getBuilderProfileCompletionLevel(count: number): BuilderProfileCompletionLevel | null {
  if (count <= 0) {
    return null;
  }

  if (count <= 3) {
    return 'Basic';
  }

  if (count <= 7) {
    return 'Good';
  }

  if (count <= 12) {
    return 'Dialled in';
  }

  return 'Fully loaded';
}

export function getBuilderProfileCompletionProgress(count: number) {
  return Math.max(0, Math.min((count / 13) * 100, 100));
}

export function getBuilderProfileCategoryLabel(category: BuilderProfileCategory) {
  return (
    BUILDER_PROFILE_CATEGORIES.find((entry) => entry.key === category)?.label ||
    'Other'
  );
}

export function getPrimaryCodingEnvironmentName(tools: Array<Pick<BuilderProfileTool, 'category' | 'name'>>) {
  return tools.find((tool) => tool.category === 'coding_environment')?.name || null;
}
