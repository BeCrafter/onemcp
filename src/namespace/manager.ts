/**
 * Namespace Manager for the MCP Router System
 *
 * Handles tool namespacing to avoid name collisions between services.
 * Uses the format: {serviceName}__{toolName}
 */

/**
 * NamespaceManager handles tool namespacing operations
 */
export class NamespaceManager {
  /**
   * Delimiter used to separate service name and tool name
   */
  private static readonly DELIMITER = '__';

  /**
   * Generate a namespaced tool name
   *
   * @param serviceName - The service name (will be sanitized)
   * @param toolName - The tool name (kept as-is)
   * @returns Namespaced name in format "{serviceName}__{toolName}"
   */
  generateNamespacedName(serviceName: string, toolName: string): string {
    const sanitized = this.sanitizeServiceName(serviceName);
    return `${sanitized}${NamespaceManager.DELIMITER}${toolName}`;
  }

  /**
   * Parse a namespaced tool name to extract service and tool names
   *
   * @param namespacedName - The namespaced tool name
   * @returns Object containing serviceName and toolName
   * @throws Error if the namespaced name is invalid (no delimiter found)
   */
  parseNamespacedName(namespacedName: string): {
    serviceName: string;
    toolName: string;
  } {
    const delimiterIndex = namespacedName.indexOf(NamespaceManager.DELIMITER);

    if (delimiterIndex === -1) {
      throw new Error(
        `Invalid namespaced name: "${namespacedName}". Expected format: "{serviceName}__{toolName}"`
      );
    }

    const serviceName = namespacedName.substring(0, delimiterIndex);
    const toolName = namespacedName.substring(delimiterIndex + NamespaceManager.DELIMITER.length);

    if (!serviceName || !toolName) {
      throw new Error(
        `Invalid namespaced name: "${namespacedName}". Both service name and tool name must be non-empty`
      );
    }

    return { serviceName, toolName };
  }

  /**
   * Sanitize a service name to ensure valid namespace names
   *
   * Rules:
   * - Convert to lowercase
   * - Keep alphanumeric characters, hyphens, and underscores
   * - Convert spaces to hyphens
   * - Remove other special characters
   *
   * @param serviceName - The service name to sanitize
   * @returns Sanitized service name
   */
  sanitizeServiceName(serviceName: string): string {
    return serviceName
      .toLowerCase()
      .replace(/\s+/g, '-') // Convert spaces to hyphens
      .replace(/[^a-z0-9\-_]/g, ''); // Keep only alphanumeric, hyphens, underscores
  }
}
