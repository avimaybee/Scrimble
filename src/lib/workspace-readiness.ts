import type { WorkspaceReadiness } from '../types';

export type WorkspaceReadinessInput = {
  aiProviderCount: number;
  builderProfileCount: number;
  alwaysOnResearchToolCount: number;
  optionalResearchToolCount: number;
};

export function deriveWorkspaceReadiness({
  aiProviderCount,
  builderProfileCount,
  alwaysOnResearchToolCount,
  optionalResearchToolCount,
}: WorkspaceReadinessInput): WorkspaceReadiness {
  const hasAiSetup = aiProviderCount > 0;
  const hasBuilderProfile = builderProfileCount >= 3;
  const hasResearchConnectivity = alwaysOnResearchToolCount + optionalResearchToolCount > 0;

  const nextActions: string[] = [];
  if (!hasAiSetup) {
    nextActions.push('Connect at least one AI key to start generation runs.');
  }
  if (!hasBuilderProfile) {
    nextActions.push('Add your core tools in Builder Profile so steps stay stack-specific.');
  }
  if (!hasResearchConnectivity) {
    nextActions.push('Connect one research tool to improve evidence quality.');
  }

  return {
    aiSetup: {
      isReady: hasAiSetup,
      connectedProviderCount: aiProviderCount,
      recommendation: hasAiSetup
        ? 'AI setup is ready for new runs.'
        : 'Add an AI key so Scrimble can generate plans.',
    },
    builderProfile: {
      isReady: hasBuilderProfile,
      savedToolCount: builderProfileCount,
      recommendation: hasBuilderProfile
        ? 'Workspace profile has enough context for stack-specific guidance.'
        : 'Save at least 3 tools to unlock stronger personalization.',
    },
    researchConnectivity: {
      isReady: hasResearchConnectivity,
      alwaysOnCount: alwaysOnResearchToolCount,
      optionalConnectedCount: optionalResearchToolCount,
      recommendation: hasResearchConnectivity
        ? 'Research connectivity is ready.'
        : 'Enable a connector for deeper research coverage.',
    },
    overallReadiness: hasAiSetup && hasBuilderProfile && hasResearchConnectivity ? 'ready' : 'needs_setup',
    nextActions,
  };
}
