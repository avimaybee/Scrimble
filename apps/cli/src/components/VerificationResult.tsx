import React from 'react';
import { Box, Text } from 'ink';
import type { VerificationResult as VerificationResultType } from '@scrimble/shared';

export interface VerificationResultProps {
  result: VerificationResultType;
}

const STATUS_COLOR: Record<VerificationResultType['status'], 'green' | 'yellow' | 'red' | 'magenta'> = {
  pass: 'green',
  warn: 'yellow',
  fail: 'red',
  manual_review: 'magenta',
};

export function VerificationResult({ result }: VerificationResultProps): JSX.Element {
  return (
    <Box flexDirection="column" gap={1}>
      <Text color={STATUS_COLOR[result.status]} bold>
        Verification: {result.status.toUpperCase()} ({Math.round(result.confidence * 100)}% confidence)
      </Text>
      {result.checks.map((check) => (
        <Text key={check.name}>
          <Text color={STATUS_COLOR[check.status]}>{check.status === 'pass' ? '✓' : check.status === 'fail' ? '✗' : '•'}</Text>
          <Text> {check.name}</Text>
          {check.message ? <Text color="gray"> — {check.message}</Text> : null}
        </Text>
      ))}
    </Box>
  );
}
