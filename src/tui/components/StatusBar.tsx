/**
 * TUI Status Bar Component
 * 
 * Displays status messages and notifications
 */

import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';

export interface StatusMessage {
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
  duration?: number;
}

export interface StatusBarProps {
  message?: StatusMessage | null;
  onClear?: () => void;
}

const getStatusIcon = (type: StatusMessage['type']): string => {
  switch (type) {
    case 'success': return '✓';
    case 'error': return '✗';
    case 'warning': return '⚠';
    case 'info': return 'ℹ';
  }
};

const getStatusColor = (type: StatusMessage['type']): string => {
  switch (type) {
    case 'success': return 'green';
    case 'error': return 'red';
    case 'warning': return 'yellow';
    case 'info': return 'blue';
  }
};

export const StatusBar: React.FC<StatusBarProps> = ({ message, onClear }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (message) {
      setVisible(true);
      const duration = message.duration || 3000;
      
      if (duration > 0) {
        const timer = setTimeout(() => {
          setVisible(false);
          onClear?.();
        }, duration);
        
        return () => clearTimeout(timer);
      }
    } else {
      setVisible(false);
    }
  }, [message, onClear]);

  if (!visible || !message) {
    return null;
  }

  const color = getStatusColor(message.type);
  const icon = getStatusIcon(message.type);

  return (
    <Box
      borderStyle="round"
      borderColor={color}
      paddingX={1}
      marginBottom={1}
    >
      <Text color={color}>
        {icon} {message.message}
      </Text>
    </Box>
  );
};
