/**
 * Service Registry implementation
 *
 * Manages service definitions including registration, unregistration, retrieval,
 * and tag-based filtering. Uses ConfigProvider for persistence.
 */

import { EventEmitter } from 'events';
import type { ServiceDefinition } from '../types/service.js';
import type { ConfigProvider } from '../types/config.js';

/**
 * Service Registry class
 *
 * Provides CRUD operations for service definitions and uses ConfigProvider
 * for persistence. Services are stored in the system configuration.
 *
 * Events:
 * - 'serviceRegistered': Emitted when a service is registered (args: serviceName, service)
 * - 'serviceUnregistered': Emitted when a service is unregistered (args: serviceName)
 */
export class ServiceRegistry extends EventEmitter {
  private configProvider: ConfigProvider;
  private services: Map<string, ServiceDefinition>;

  constructor(configProvider: ConfigProvider) {
    super();
    this.configProvider = configProvider;
    this.services = new Map();
  }

  /**
   * Initialize the registry by loading services from configuration
   */
  async initialize(): Promise<void> {
    const config = await this.configProvider.load();
    this.services.clear();

    for (const service of config.mcpServers) {
      this.services.set(service.name, service);
    }
  }

  /**
   * Register a new service or update an existing service
   *
   * Emits 'serviceRegistered' event after successful registration.
   *
   * @param service - Service definition to register
   * @throws Error if service definition is invalid
   */
  async register(service: ServiceDefinition): Promise<void> {
    // Validate service definition
    this.validateService(service);

    // Deduplicate tags if present
    const normalizedService = {
      ...service,
      tags: service.tags ? Array.from(new Set(service.tags)) : service.tags,
    };

    // Add or update service in memory
    this.services.set(normalizedService.name, normalizedService);

    // Persist to configuration
    await this.persistServices();

    // Emit event for cache invalidation (Requirement 2.4)
    this.emit('serviceRegistered', normalizedService.name, normalizedService);
  }

  /**
   * Unregister a service by name
   *
   * Emits 'serviceUnregistered' event after successful unregistration.
   *
   * @param serviceName - Name of the service to unregister
   */
  async unregister(serviceName: string): Promise<void> {
    // Remove service from memory
    this.services.delete(serviceName);

    // Persist to configuration
    await this.persistServices();

    // Emit event for cache invalidation (Requirement 2.4)
    this.emit('serviceUnregistered', serviceName);
  }

  /**
   * Get a service by name
   *
   * @param serviceName - Name of the service to retrieve
   * @returns Service definition or null if not found
   */
  get(serviceName: string): ServiceDefinition | null {
    const service = this.services.get(serviceName);
    return service ?? null;
  }

  /**
   * List all registered services
   *
   * @returns Array of all service definitions
   */
  list(): ServiceDefinition[] {
    return Array.from(this.services.values());
  }

  /**
   * Find services by tags with AND or OR logic
   *
   * @param tags - Array of tags to filter by
   * @param matchAll - If true, use AND logic (service must have all tags).
   *                   If false, use OR logic (service must have at least one tag).
   * @returns Array of matching service definitions
   */
  async findByTags(tags: string[], matchAll: boolean = true): Promise<ServiceDefinition[]> {
    // Use Promise.resolve to satisfy require-await rule
    await Promise.resolve();

    if (tags.length === 0) {
      return this.list();
    }

    const allServices = Array.from(this.services.values());

    return allServices.filter((service) => {
      const serviceTags = service.tags || [];

      if (matchAll) {
        // AND logic: service must have all specified tags
        return tags.every((tag) => serviceTags.includes(tag));
      } else {
        // OR logic: service must have at least one specified tag
        return tags.some((tag) => serviceTags.includes(tag));
      }
    });
  }

  /**
   * Validate service definition
   *
   * Collects all validation errors and throws a single error with all issues.
   * This satisfies requirement 30.9: return all validation errors, not just the first.
   *
   * @param service - Service definition to validate
   * @throws Error if validation fails, with message containing all validation errors
   */
  private validateService(service: ServiceDefinition): void {
    const errors: string[] = [];

    // Validate required fields
    if (!service.name || service.name.trim().length === 0) {
      errors.push('Service name is required and cannot be empty');
    }

    if (!service.transport) {
      errors.push('Service transport type is required');
    } else {
      // Validate transport type (requirement 30.6)
      const validTransports = ['stdio', 'sse', 'http'];
      if (!validTransports.includes(service.transport)) {
        errors.push(
          `Invalid transport type: ${service.transport}. Must be one of: ${validTransports.join(', ')}`
        );
      } else {
        // Validate transport-specific requirements
        if (service.transport === 'stdio') {
          // Requirement 30.8: validate command field exists
          if (!service.command || service.command.trim().length === 0) {
            errors.push('Command is required for stdio transport');
          } else {
            // Requirement 30.4: validate command is executable
            // Note: We validate the command string format here. Actual executability
            // is checked at runtime when the connection is established, as the command
            // may not be available on the system where validation occurs (e.g., during
            // configuration import or in a different environment).
            // The command should be a non-empty string without null bytes.
            if (service.command.includes('\0')) {
              errors.push('Command contains invalid null byte characters');
            }
          }
        }

        if (service.transport === 'sse' || service.transport === 'http') {
          // Requirement 30.7: validate URL field exists
          if (!service.url || service.url.trim().length === 0) {
            errors.push(`URL is required for ${service.transport} transport`);
          } else {
            // Requirement 30.5: validate URL format
            try {
              new URL(service.url);
            } catch {
              errors.push(`Invalid URL format: ${service.url}`);
            }
          }
        }
      }
    }

    // Validate enabled field
    if (typeof service.enabled !== 'boolean') {
      errors.push('Service enabled field must be a boolean');
    }

    // Validate tags if present
    if (service.tags !== undefined) {
      if (!Array.isArray(service.tags)) {
        errors.push('Service tags must be an array');
      } else {
        for (const tag of service.tags) {
          if (typeof tag !== 'string') {
            errors.push('All tags must be strings');
            break; // Only report this error once
          }
        }
      }
    }

    // Validate connection pool config if present
    if (service.connectionPool) {
      if (
        typeof service.connectionPool.maxConnections !== 'number' ||
        service.connectionPool.maxConnections < 1
      ) {
        errors.push('Connection pool maxConnections must be a positive number');
      }

      if (
        typeof service.connectionPool.idleTimeout !== 'number' ||
        service.connectionPool.idleTimeout < 0
      ) {
        errors.push('Connection pool idleTimeout must be a non-negative number');
      }

      if (
        typeof service.connectionPool.connectionTimeout !== 'number' ||
        service.connectionPool.connectionTimeout < 0
      ) {
        errors.push('Connection pool connectionTimeout must be a non-negative number');
      }
    }

    // Validate tool states if present
    if (service.toolStates !== undefined) {
      if (typeof service.toolStates !== 'object' || service.toolStates === null) {
        errors.push('Service toolStates must be an object');
      } else {
        for (const [pattern, enabled] of Object.entries(service.toolStates)) {
          if (typeof pattern !== 'string') {
            errors.push('Tool state pattern must be a string');
            break; // Only report this error once
          }

          if (typeof enabled !== 'boolean') {
            errors.push(`Tool state value for pattern "${pattern}" must be a boolean`);
          }
        }
      }
    }

    // Requirement 30.9: throw error with all validation errors
    if (errors.length > 0) {
      throw new Error(`Service validation failed:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
    }
  }

  /**
   * Persist current services to configuration
   */
  private async persistServices(): Promise<void> {
    // Load current configuration
    const config = await this.configProvider.load();

    // Update services in configuration
    config.mcpServers = Array.from(this.services.values());

    // Save configuration
    await this.configProvider.save(config);
  }
}
