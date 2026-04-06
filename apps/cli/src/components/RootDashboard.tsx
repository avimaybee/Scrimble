import React, { useEffect } from 'react';
import { Box, Text, useApp } from 'ink';
import { ChunkDisplay } from './ChunkDisplay.js';
import { Progress } from './Progress.js';
import { StatusBar } from './StatusBar.js';

export interface RootDashboardProps {
  projectName: string;
  projectGoal?: string | null;
  progress: {
    completed: number;
    total: number;
    skipped: number;
  };
  activeChunk?: {
    title: string;
    prompt: string;
    doneWhen?: string;
    doNotTouch?: string;
  };
  nextChunkTitle?: string;
  staleMessages?: string[];
}

export function RootDashboard(props: RootDashboardProps): JSX.Element {
  const { exit } = useApp();
  useEffect(() => {
    exit();
  }, [exit]);

  const status: 'idle' | 'working' | 'warning' = props.staleMessages && props.staleMessages.length > 0
    ? 'warning'
    : props.activeChunk
      ? 'working'
      : 'idle';

  return (
    <Box flexDirection="column" gap={1}>
      <StatusBar
        projectName={props.projectName}
        status={status}
        detail={`${props.progress.completed}/${props.progress.total} complete`}
      />
      {props.projectGoal ? (
        <Text color="gray">Goal: {props.projectGoal}</Text>
      ) : null}
      <Progress completed={props.progress.completed} total={props.progress.total} />
      {props.progress.skipped > 0 ? (
        <Text color="yellow">Skipped chunks: {props.progress.skipped}</Text>
      ) : null}
      {props.activeChunk ? (
        <ChunkDisplay
          title={props.activeChunk.title}
          prompt={props.activeChunk.prompt}
          doneWhen={props.activeChunk.doneWhen ?? 'See prompt details'}
          {...(props.activeChunk.doNotTouch ? { doNotTouch: props.activeChunk.doNotTouch } : {})}
        />
      ) : props.nextChunkTitle ? (
        <Text color="cyan">Next available chunk: {props.nextChunkTitle}</Text>
      ) : (
        <Text color="green">All chunks are complete or intentionally skipped.</Text>
      )}
      {props.staleMessages && props.staleMessages.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color="yellow" bold>
            Integrity notes:
          </Text>
          {props.staleMessages.map((message) => (
            <Text key={message} color="yellow">
              - {message}
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
