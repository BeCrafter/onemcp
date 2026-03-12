/**
 * Data masking utility for sensitive information
 */

/**
 * Data masking configuration
 */
export interface DataMaskingConfig {
  /** Enable data masking */
  enabled: boolean;
  /** Patterns to mask (field names or regex patterns) */
  patterns: string[];
  /** Replacement string */
  replacement?: string;
}

/**
 * Default sensitive field patterns
 */
export const DEFAULT_SENSITIVE_PATTERNS = [
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'key',
  'apikey',
  'api_key',
  'auth',
  'authorization',
  'credential',
  'private',
];

/**
 * Data masker for sensitive information
 */
export class DataMasker {
  private config: DataMaskingConfig;
  private patterns: RegExp[];

  constructor(config: DataMaskingConfig) {
    this.config = config;
    this.patterns = this.compilePatterns();
  }

  /**
   * Compile patterns into regex
   */
  private compilePatterns(): RegExp[] {
    return this.config.patterns.map((pattern) => {
      try {
        // Try to use as regex
        return new RegExp(pattern, 'i');
      } catch {
        // Fall back to exact match (case-insensitive)
        return new RegExp(`^${this.escapeRegex(pattern)}$`, 'i');
      }
    });
  }

  /**
   * Escape special regex characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Check if a field name matches sensitive patterns
   */
  private isSensitiveField(fieldName: string): boolean {
    if (!this.config.enabled) {
      return false;
    }

    return this.patterns.some((pattern) => pattern.test(fieldName));
  }

  /**
   * Mask a value
   */
  private maskValue(_value: unknown): string {
    return this.config.replacement || '***MASKED***';
  }

  /**
   * Mask sensitive data in an object
   */
  maskObject(obj: unknown): unknown {
    if (!this.config.enabled) {
      return obj;
    }

    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.maskObject(item));
    }

    const masked: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (this.isSensitiveField(key)) {
        // Always mask sensitive fields, even if value is empty/whitespace
        masked[key] = this.maskValue(value);
      } else if (typeof value === 'object' && value !== null) {
        // Recursively mask nested objects
        masked[key] = this.maskObject(value);
      } else {
        // Keep non-sensitive primitive values as-is
        masked[key] = value;
      }
    }

    return masked;
  }

  /**
   * Mask sensitive data in a string (for log messages)
   */
  maskString(str: string): string {
    if (!this.config.enabled) {
      return str;
    }

    let masked = str;

    // Mask common patterns in strings
    for (const pattern of this.config.patterns) {
      // Match patterns like "password=value" or "password: value"
      const regex1 = new RegExp(`(${pattern})\\s*[:=]\\s*([^\\s,}\\]]+)`, 'gi');
      masked = masked.replace(regex1, `$1=${this.maskValue('')}`);

      // Also mask the word itself when it appears in error messages
      const regex2 = new RegExp(`\\b${pattern}\\b`, 'gi');
      masked = masked.replace(regex2, this.maskValue(''));
    }

    return masked;
  }

  /**
   * Update masking patterns
   */
  updatePatterns(patterns: string[]): void {
    this.config.patterns = patterns;
    this.patterns = this.compilePatterns();
  }

  /**
   * Enable or disable masking
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }
}

/**
 * Create a data masker instance
 */
export function createDataMasker(config: DataMaskingConfig): DataMasker {
  return new DataMasker(config);
}
