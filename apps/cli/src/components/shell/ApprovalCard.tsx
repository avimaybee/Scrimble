import React from 'react';
import { Box, Text } from 'ink';
import type { OperatorBoundary } from '../../lib/agent/types.js';

export interface ApprovalCardProps {
  boundary: OperatorBoundary;
  actionable: boolean;
}

export function ApprovalCard({ boundary, actionable }: ApprovalCardProps): JSX.Element {
  return (
    <Box borderStyle="round" borderColor="yellow" paddingX={1} flexDirection="column">
      <Text bold color="yellow">
        Approval needed
      </Text>
      <Text>{boundary.actionSummary}</Text>
      <Text color="gray">{boundary.reason}</Text>
      {boundary.category ? <Text color="gray">Category: {boundary.category}</Text> : null}
      {boundary.riskLevel ? <Text color="gray">Risk: {boundary.riskLevel}</Text> : null}
      <Text color="gray">
        Scope: parallel={boundary.scope.parallel}, maxTasks={boundary.scope.maxTasks}
      </Text>
      {boundary.nextStepHint ? <Text color="gray">If approved: {boundary.nextStepHint}</Text> : null}
      <Text color="gray">
        {actionable
          ? 'Ctrl+Y proceed • Ctrl+P pause • type redirect and press Enter'
          : 'Press Enter to resume and review this approval boundary'}
      </Text>
    </Box>
  );
}
