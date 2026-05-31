import React from 'react';
import { Box, Text } from 'ink';

export interface ChunkDisplayProps {
  title: string;
  prompt: string;
  doneWhen: string;
  doNotTouch?: string;
}

export function ChunkDisplay({ title, prompt, doneWhen, doNotTouch }: ChunkDisplayProps): JSX.Element {
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color="cyan">
        Current Chunk: {title}
      </Text>
      <Box borderStyle="round" borderColor="gray" paddingX={1} paddingY={1}>
        <Text>{prompt}</Text>
      </Box>
      <Text color="green">Done When: {doneWhen}</Text>
      {doNotTouch ? <Text color="yellow">Do Not Touch: {doNotTouch}</Text> : null}
    </Box>
  );
}
