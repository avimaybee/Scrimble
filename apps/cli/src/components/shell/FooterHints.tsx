import React from 'react';
import { Box, Text } from 'ink';

export interface FooterHintsProps {
  awaitingApproval: boolean;
}

export function FooterHints({ awaitingApproval }: FooterHintsProps): JSX.Element {
  return (
    <Box>
      <Text color="gray">
        Enter submit • Esc exit • Ctrl+V details • Ctrl+G providers • Ctrl+R resume • Ctrl+T retry • Ctrl+N replan • Ctrl+O plan • Ctrl+F failure • Ctrl+L logs • Ctrl+K repair • Ctrl+U foundation • Ctrl+D dismiss
        {awaitingApproval ? ' • Ctrl+Y proceed • Ctrl+P pause' : ''}
      </Text>
    </Box>
  );
}
