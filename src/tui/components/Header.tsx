/**
 * TUI Header Component
 * 
 * Displays application title, status, and key information
 */

import React from 'react';
import { Box, Text } from 'ink';

export interface HeaderProps {
  title?: string;
  subtitle?: string;
  stats?: Array<{ label: string; value: string | number; color?: string }>;
  showHelp?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  title = 'MCP Router System',
  subtitle = 'Configuration Manager',
  stats = [],
  showHelp = false,
}) => {
  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Title bar */}
      <Box
        borderStyle="double"
        borderColor="cyan"
        paddingX={2}
        paddingY={0}
        justifyContent="space-between"
      >
        <Box>
          <Text bold color="cyan">{title}</Text>
          {subtitle && (
            <>
              <Text dimColor> • </Text>
              <Text dimColor>{subtitle}</Text>
            </>
          )}
        </Box>
        {showHelp && (
          <Text dimColor>Press ? for help</Text>
        )}
      </Box>

      {/* Stats bar */}
      {stats.length > 0 && (
        <Box paddingX={1} paddingY={0}>
          {stats.map((stat, index) => (
            <React.Fragment key={index}>
              {index > 0 && <Text dimColor> • </Text>}
              <Text dimColor>{stat.label}: </Text>
              <Text color={stat.color || 'white'}>{stat.value}</Text>
            </React.Fragment>
          ))}
        </Box>
      )}
    </Box>
  );
};
