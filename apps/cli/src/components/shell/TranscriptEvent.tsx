import React from 'react';
import { Box, Text } from 'ink';
import type { TranscriptEntry, TranscriptKind } from './types.js';

const KIND_META: Record<TranscriptKind, { label: string; color: 'cyan' | 'gray' | 'blue' | 'green' | 'yellow' | 'red' }> = {
  startup: { label: 'startup', color: 'gray' },
  user_input: { label: 'you', color: 'cyan' },
  agent_summary: { label: 'agent', color: 'gray' },
  step_started: { label: 'step', color: 'blue' },
  step_completed: { label: 'done', color: 'green' },
  approval_needed: { label: 'approval', color: 'yellow' },
  paused: { label: 'paused', color: 'yellow' },
  blocked: { label: 'blocked', color: 'red' },
  completed: { label: 'completed', color: 'green' },
  system: { label: 'system', color: 'gray' },
  error: { label: 'error', color: 'red' },
};

export interface TranscriptEventProps {
  entry: TranscriptEntry;
  showDetails: boolean;
}

export function TranscriptEvent({ entry, showDetails }: TranscriptEventProps): JSX.Element {
  const meta = KIND_META[entry.kind];
  const alwaysShowDetails = entry.kind === 'step_completed' && entry.message.startsWith('Plan review:');
  return (
    <Box flexDirection="column">
      <Text>
        <Text color={meta.color} bold>
          [{meta.label}]
        </Text>{' '}
        <Text>{entry.message}</Text>
      </Text>
      {(showDetails || alwaysShowDetails) && entry.details?.length ? (
        <Box flexDirection="column" marginLeft={2}>
          {entry.details.map((detail) => (
            <Text key={`${entry.id}-${detail}`} color="gray">
              {detail}
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
