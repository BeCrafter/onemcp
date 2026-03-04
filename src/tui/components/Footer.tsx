/**
 * TUI Footer Component
 * 
 * Displays keyboard shortcuts and help information
 */

import React from 'react';
import { Box, Text } from 'ink';

export interface Shortcut {
  key: string;
  description: string;
  group?: string;
}

export interface FooterProps {
  shortcuts?: Shortcut[];
  compact?: boolean;
}

export const Footer: React.FC<FooterProps> = ({ shortcuts = [], compact = false }) => {
  if (shortcuts.length === 0) {
    return null;
  }

  // Group shortcuts if not compact
  if (!compact && shortcuts.some(s => s.group)) {
    const groups = shortcuts.reduce((acc, shortcut) => {
      const group = shortcut.group || 'Other';
      if (!acc[group]) acc[group] = [];
      acc[group]!.push(shortcut);
      return acc;
    }, {} as Record<string, Shortcut[]>);

    return (
      <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
        {Object.entries(groups).map(([group, items]) => (
          <Box key={group} flexDirection="column">
            <Text bold dimColor>{group}:</Text>
            <Box flexWrap="wrap">
              {items.map((shortcut, index) => (
                <Box key={index} marginRight={2}>
                  <Text color="cyan">{shortcut.key}</Text>
                  <Text dimColor>: {shortcut.description}</Text>
                </Box>
              ))}
            </Box>
          </Box>
        ))}
      </Box>
    );
  }

  // Compact mode - single line
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      <Box flexWrap="wrap">
        {shortcuts.map((shortcut, index) => (
          <React.Fragment key={index}>
            {index > 0 && <Text dimColor> | </Text>}
            <Text color="cyan">{shortcut.key}</Text>
            <Text dimColor>: {shortcut.description}</Text>
          </React.Fragment>
        ))}
      </Box>
    </Box>
  );
};
