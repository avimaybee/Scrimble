import React from 'react';
import { Box, Text } from 'ink';

export interface ComposerProps {
  draft: string;
  disabled?: boolean;
  placeholder: string;
}

export function Composer({ draft, disabled = false, placeholder }: ComposerProps): JSX.Element {
  return (
    <Box borderStyle="single" borderColor={disabled ? 'gray' : 'cyan'} paddingX={1}>
      <Text color={disabled ? 'gray' : 'cyan'}>{'>'}</Text>
      <Text> </Text>
      {draft ? <Text>{draft}</Text> : <Text color="gray">{placeholder}</Text>}
    </Box>
  );
}
