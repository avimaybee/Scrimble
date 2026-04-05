import React from 'react';
import { Box, Text } from 'ink';

export interface ProgressProps {
  completed: number;
  total: number;
  width?: number;
}

export function Progress({ completed, total, width = 24 }: ProgressProps): JSX.Element {
  const safeTotal = Math.max(total, 1);
  const ratio = Math.min(Math.max(completed / safeTotal, 0), 1);
  const completeWidth = Math.round(width * ratio);

  return (
    <Box flexDirection="column">
      <Text>
        <Text color="green">{'█'.repeat(completeWidth)}</Text>
        <Text color="gray">{'░'.repeat(width - completeWidth)}</Text>
        <Text> {completed}/{total}</Text>
      </Text>
    </Box>
  );
}
