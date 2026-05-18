/**
 * Tool Description Auto-Enhancer
 *
 * MCP backends often expose tools with empty or very short descriptions
 * (e.g., "", "Do the thing"). This degrades search quality because the
 * description field is the primary human-readable signal after the tool name.
 *
 * This module derives a readable description from the tool name and service
 * name when the original description is missing or below a useful length
 * threshold. The enhanced description is cached with the tool; no external
 * calls or persisted mutations are made.
 */

/** Description length below which auto-enhancement is applied */
export const MIN_USEFUL_DESCRIPTION_LENGTH = 20;

/**
 * Convert a snake_case or camelCase identifier into a Title Case phrase.
 *
 * Examples:
 *   "read_file"           → "Read File"
 *   "create_pull_request" → "Create Pull Request"
 *   "readFileContent"     → "Read File Content"
 *   "filesystem"          → "Filesystem"
 */
export function nameToPhrase(name: string): string {
  return (
    name
      // Split camelCase boundaries: "readFile" → "read File"
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      // Replace common separators with space
      .split(/[_\-\s]+/)
      .filter((w) => w.length > 0)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ')
  );
}

/**
 * Auto-enhance a tool description when the original is missing or too short.
 *
 * Enhancement strategy:
 * - Description already useful (>= MIN_USEFUL_DESCRIPTION_LENGTH chars): return as-is
 * - Empty description: generate "Tool Phrase (Service Phrase)"
 * - Short description: prepend generated phrase for better search token coverage
 *
 * @param toolName    - Raw tool name from the backend (e.g., "read_file")
 * @param serviceName - Service/namespace name (e.g., "filesystem")
 * @param description - Original description from the backend (may be empty)
 * @returns Original or enhanced description string
 */
export function enhanceDescription(
  toolName: string,
  serviceName: string,
  description: string
): string {
  if (description.length >= MIN_USEFUL_DESCRIPTION_LENGTH) {
    return description;
  }

  const toolPhrase = nameToPhrase(toolName);
  const servicePhrase = nameToPhrase(serviceName);

  if (!description) {
    return `${toolPhrase} (${servicePhrase})`;
  }

  // Short description: prepend derived phrase so name tokens are searchable
  return `${toolPhrase}: ${description}`;
}
