/**
 * File Import Dialog Component
 * 
 * Dialog for importing JSON configuration from a file.
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import fs from 'fs/promises';
import path from 'path';

export interface FileImportDialogProps {
  /** Callback when file is imported */
  onImport: (content: string) => void;
  /** Callback when dialog is cancelled */
  onCancel: () => void;
}

/**
 * File Import Dialog Component
 */
export const FileImportDialog: React.FC<FileImportDialogProps> = ({
  onImport,
  onCancel,
}) => {
  const [filePath, setFilePath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Handle file import
  const handleImport = async () => {
    if (!filePath.trim()) {
      setError('File path is required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Resolve path (support ~ for home directory)
      let resolvedPath = filePath.trim();
      if (resolvedPath.startsWith('~')) {
        const homeDir = process.env['HOME'] || process.env['USERPROFILE'] || '';
        resolvedPath = path.join(homeDir, resolvedPath.slice(1));
      }

      // Read file
      const content = await fs.readFile(resolvedPath, 'utf-8');
      
      // Validate it's valid JSON
      try {
        JSON.parse(content);
      } catch {
        setError('File does not contain valid JSON');
        setLoading(false);
        return;
      }

      onImport(content);
    } catch (err) {
      const error = err as Error;
      setError(`Failed to read file: ${error.message}`);
      setLoading(false);
    }
  };

  // Handle keyboard input
  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="round" borderColor="cyan" padding={1} marginBottom={1}>
        <Text bold color="cyan">Import from File</Text>
      </Box>

      <Box flexDirection="column" borderStyle="single" padding={1} marginBottom={1}>
        <Text bold color="yellow">File Path:</Text>
        <Text dimColor>Enter the path to a JSON configuration file</Text>
        <Text dimColor>Supports: ~/path/to/file.json or /absolute/path/file.json</Text>
        <Box marginTop={1}>
          <TextInput
            value={filePath}
            onChange={setFilePath}
            onSubmit={handleImport}
            placeholder="~/config/services.json"
          />
        </Box>
      </Box>

      {error && (
        <Box borderStyle="single" borderColor="red" padding={1} marginBottom={1}>
          <Text color="red">✗ {error}</Text>
        </Box>
      )}

      {loading && (
        <Box borderStyle="single" borderColor="yellow" padding={1} marginBottom={1}>
          <Text color="yellow">Loading file...</Text>
        </Box>
      )}

      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text dimColor>Enter: Import | Esc: Cancel</Text>
      </Box>
    </Box>
  );
};
