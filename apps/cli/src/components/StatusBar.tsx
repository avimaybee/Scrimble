import React from 'react';
import { Box, Text } from 'ink';

export interface StatusBarProps {
  projectName: string;
  status: 'idle' | 'working' | 'warning' | 'error';
  detail?: string;
}

const STATUS_COLOR: Record<StatusBarProps['status'], 'gray' | 'green' | 'yellow' | 'red'> = {
  idle: 'gray',
  working: 'green',
  warning: 'yellow',
  error: 'red',
};

export function StatusBar({ projectName, status, detail }: StatusBarProps): JSX.Element {
  return (
    <Box borderStyle="single" borderColor={STATUS_COLOR[status]} paddingX={1}>
      <Text>
        <Text bold>{projectName}</Text>
        <Text> • </Text>
        <Text color={STATUS_COLOR[status]}>{status.toUpperCase()}</Text>
        {detail ? (
          <>
            <Text> • </Text>
            <Text>{detail}</Text>
          </>
        ) : null}
      </Text>
    </Box>
  );
}
