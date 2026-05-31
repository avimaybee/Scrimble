import React from 'react';
import { Box, Text } from 'ink';

export interface EnvironmentStripProps {
  repoName: string;
  branch?: string | undefined;
  profileName?: string | undefined;
  provider?: string | undefined;
  modelStrategy?: 'auto' | 'explicit' | undefined;
  model?: string | undefined;
  modelAvailability?: 'available' | 'unverified' | 'unavailable' | undefined;
  capabilitySource?: 'live' | 'cached' | 'fallback' | undefined;
  validationFreshness?: 'fresh' | 'stale' | undefined;
  authStatus?: 'ready' | 'missing' | 'invalid' | undefined;
  authSource?: string | undefined;
  runtimeReady: boolean;
  orchestratorState: 'idle' | 'running' | 'awaiting-approval' | 'paused';
  activeRequest?: string | undefined;
}

function labelColor(state: EnvironmentStripProps['orchestratorState']): 'gray' | 'green' | 'yellow' {
  if (state === 'running') {
    return 'green';
  }
  if (state === 'awaiting-approval' || state === 'paused') {
    return 'yellow';
  }
  return 'gray';
}

export function EnvironmentStrip({
  repoName,
  branch,
  profileName,
  provider,
  modelStrategy,
  model,
  modelAvailability,
  capabilitySource,
  validationFreshness,
  authStatus,
  authSource,
  runtimeReady,
  orchestratorState,
  activeRequest,
}: EnvironmentStripProps): JSX.Element {
  const modelLabel = modelStrategy === 'auto' ? 'auto' : (model ?? '-');
  const aiLabel = provider ? `${provider}/${modelLabel}` : 'not configured';
  const authLabel = authStatus
    ? authSource ? `${authStatus} (${authSource})` : authStatus
    : 'unknown';
  const capabilityLabel = capabilitySource
    ? `${capabilitySource}${validationFreshness ? `/${validationFreshness}` : ''}`
    : 'unknown';
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1} flexDirection="column">
      <Text>
        <Text bold>Repo:</Text> {repoName}
        <Text color="gray"> | </Text>
        <Text bold>Branch:</Text> {branch ?? '-'}
        <Text color="gray"> | </Text>
        <Text bold>Profile:</Text> {profileName ?? '-'}
        <Text color="gray"> | </Text>
        <Text bold>AI:</Text> {aiLabel}
      </Text>
      <Text>
        <Text bold>Auth:</Text>{' '}
        <Text color={authStatus === 'ready' ? 'green' : authStatus === 'missing' ? 'yellow' : authStatus === 'invalid' ? 'red' : 'gray'}>
          {authLabel}
        </Text>
        <Text color="gray"> | </Text>
        <Text bold>Capabilities:</Text>{' '}
        <Text color={capabilitySource === 'live' ? 'green' : capabilitySource === 'cached' ? 'yellow' : capabilitySource === 'fallback' ? 'yellow' : 'gray'}>
          {capabilityLabel}
        </Text>
        {modelAvailability ? (
          <>
            <Text color="gray"> | </Text>
            <Text bold>Model:</Text>{' '}
            <Text color={modelAvailability === 'available' ? 'green' : modelAvailability === 'unavailable' ? 'red' : 'yellow'}>
              {modelAvailability}
            </Text>
          </>
        ) : null}
        <Text color="gray"> | </Text>
        <Text bold>Runtime:</Text>{' '}
        <Text color={runtimeReady ? 'green' : 'yellow'}>{runtimeReady ? 'ready' : 'not initialized'}</Text>
        <Text color="gray"> | </Text>
        <Text bold>Orchestrator:</Text> <Text color={labelColor(orchestratorState)}>{orchestratorState}</Text>
      </Text>
      {activeRequest ? (
        <Text>
          <Text bold>Active request:</Text> {activeRequest}
        </Text>
      ) : null}
    </Box>
  );
}
