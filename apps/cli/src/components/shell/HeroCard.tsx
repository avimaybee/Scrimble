import React from 'react';
import { Box, Text } from 'ink';
import type { InteractionMode } from '@scrimble/shared';

const MODE_LABELS: Record<InteractionMode, string> = {
  guide: 'guide',
  balanced: 'balanced',
  operator: 'operator',
};

export interface HeroCardProps {
  mode: InteractionMode;
  startupHint: string;
}

export function HeroCard({ mode, startupHint }: HeroCardProps): JSX.Element {
  return (
    <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
      <Text bold color="cyan">
        Scrimble Operator Shell
      </Text>
      <Text color="gray">Mode: {MODE_LABELS[mode]}</Text>
      <Text color="gray">{startupHint}</Text>
    </Box>
  );
}
