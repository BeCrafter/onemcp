/**
 * TUI Help Dialog Component
 * 
 * Displays comprehensive help information
 */

import React from 'react';
import { Box, Text, useInput } from 'ink';

export interface HelpDialogProps {
  onClose: () => void;
}

export const HelpDialog: React.FC<HelpDialogProps> = ({ onClose }) => {
  useInput((input, key) => {
    if (key.escape || input === '?' || input === 'q') {
      onClose();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="double" borderColor="cyan" paddingX={2} marginBottom={1}>
        <Text bold color="cyan">Help - Keyboard Shortcuts</Text>
      </Box>

      <Box flexDirection="column" borderStyle="single" paddingX={1} marginBottom={1}>
        <Text bold color="yellow">Service List View</Text>
        <Box flexDirection="column" marginLeft={2}>
          <Text><Text color="cyan">↑/↓</Text> - Navigate services</Text>
          <Text><Text color="cyan">Enter</Text> - Edit selected service</Text>
          <Text><Text color="cyan">a</Text> - Add new service</Text>
          <Text><Text color="cyan">e</Text> - Edit selected service</Text>
          <Text><Text color="cyan">d</Text> - Delete selected service</Text>
          <Text><Text color="cyan">Space/t</Text> - Toggle service enabled/disabled</Text>
          <Text><Text color="cyan">v</Text> - View service tools</Text>
          <Text><Text color="cyan">r</Text> - Refresh service list</Text>
          <Text><Text color="cyan">y</Text> - Toggle form mode (unified/traditional)</Text>
          <Text><Text color="cyan">?</Text> - Show this help</Text>
          <Text><Text color="cyan">q</Text> - Quit application</Text>
        </Box>
      </Box>

      <Box flexDirection="column" borderStyle="single" paddingX={1} marginBottom={1}>
        <Text bold color="yellow">Service Form (Unified)</Text>
        <Box flexDirection="column" marginLeft={2}>
          <Text><Text color="cyan">Tab</Text> - Next field</Text>
          <Text><Text color="cyan">Shift+Tab</Text> - Previous field</Text>
          <Text><Text color="cyan">Enter</Text> - Confirm field and move to next</Text>
          <Text><Text color="cyan">Ctrl+A</Text> - Toggle advanced options</Text>
          <Text><Text color="cyan">Ctrl+S</Text> - Save service</Text>
          <Text><Text color="cyan">Esc</Text> - Cancel and return</Text>
        </Box>
      </Box>

      <Box flexDirection="column" borderStyle="single" paddingX={1} marginBottom={1}>
        <Text bold color="yellow">Service Form (Traditional)</Text>
        <Box flexDirection="column" marginLeft={2}>
          <Text><Text color="cyan">Enter</Text> - Next step</Text>
          <Text><Text color="cyan">↑/↓</Text> - Select option (for dropdowns)</Text>
          <Text><Text color="cyan">p</Text> - Preview configuration (at confirm step)</Text>
          <Text><Text color="cyan">Esc</Text> - Cancel and return</Text>
        </Box>
      </Box>

      <Box flexDirection="column" borderStyle="single" paddingX={1} marginBottom={1}>
        <Text bold color="yellow">Tools View</Text>
        <Box flexDirection="column" marginLeft={2}>
          <Text><Text color="cyan">↑/↓</Text> - Navigate tools</Text>
          <Text><Text color="cyan">←/→</Text> - Scroll description</Text>
          <Text><Text color="cyan">Space/t</Text> - Toggle tool enabled/disabled</Text>
          <Text><Text color="cyan">a</Text> - Enable all tools</Text>
          <Text><Text color="cyan">Shift+A</Text> - Disable all tools</Text>
          <Text><Text color="cyan">Esc</Text> - Back to service list</Text>
        </Box>
      </Box>

      <Box flexDirection="column" borderStyle="single" paddingX={1} marginBottom={1}>
        <Text bold color="yellow">JSON Editor</Text>
        <Box flexDirection="column" marginLeft={2}>
          <Text><Text color="cyan">Ctrl+S</Text> - Save JSON</Text>
          <Text><Text color="cyan">Esc</Text> - Cancel and return</Text>
        </Box>
      </Box>

      <Box flexDirection="column" borderStyle="single" paddingX={1} marginBottom={1}>
        <Text bold color="yellow">Client Tag Filtering</Text>
        <Box flexDirection="column" marginLeft={2}>
          <Text><Text color="cyan">tagFilter</Text> - Clients specify tags in initialize request params</Text>
          <Text><Text color="cyan">tags</Text> - Array of tags to match (e.g., ["production", "api"])</Text>
          <Text><Text color="cyan">logic</Text> - "AND" (all tags required) or "OR" (any tag matches)</Text>
          <Text dimColor>Services without tags are always available to all clients</Text>
          <Text dimColor>Works for both stdio and HTTP modes via JSON-RPC initialize</Text>
        </Box>
      </Box>

      <Box borderStyle="single" borderColor="cyan" paddingX={1}>
        <Text color="cyan">Press Esc, ?, or q to close this help</Text>
      </Box>
    </Box>
  );
};
