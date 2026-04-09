import React from 'react';
import { Box, Text } from 'ink';
import type { TranscriptEntry } from './types.js';
import { TranscriptEvent } from './TranscriptEvent.js';

export interface TranscriptPaneProps {
  entries: TranscriptEntry[];
  showDetails: boolean;
  maxEntries: number;
}

export function TranscriptPane({ entries, showDetails, maxEntries }: TranscriptPaneProps): JSX.Element {
  const visible = entries.slice(Math.max(0, entries.length - maxEntries));
  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1} paddingY={0} flexDirection="column" flexGrow={1}>
      <Text bold color="gray">
        Transcript
      </Text>
      {visible.length === 0 ? <Text color="gray">No activity yet.</Text> : null}
      {visible.map((entry) => (
        <TranscriptEvent key={entry.id} entry={entry} showDetails={showDetails} />
      ))}
    </Box>
  );
}
