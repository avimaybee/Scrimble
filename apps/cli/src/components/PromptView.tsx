import React from 'react';
import { Box, Text } from 'ink';

export interface PromptViewProps {
  content: string;
  title?: string;
}

export function PromptView({ content, title = 'Prompt' }: PromptViewProps): JSX.Element {
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color="magenta">
        {title}
      </Text>
      <Box borderStyle="round" borderColor="magenta" paddingX={1} paddingY={1}>
        <Text>{content}</Text>
      </Box>
    </Box>
  );
}
