# Health Check Integration Guide

## Overview

The HealthMonitor now performs an initial health check when a service's connection pool is registered. This ensures that only healthy services have their tools enabled, as required by Requirement 20.9.

## Implementation Details

### HealthMonitor.registerConnectionPool()

The `registerConnectionPool()` method has been updated to:

1. Register the connection pool for the service
2. Perform an initial health check immediately
3. Emit appropriate events based on the health check result:
   - `serviceHealthy` event if the check passes
   - `serviceUnhealthy` event if the check fails
4. Return the initial health status

```typescript
public async registerConnectionPool(
  serviceName: string, 
  pool: ConnectionPool
): Promise<HealthStatus>
```

### Events Emitted

- **serviceHealthy**: Emitted when initial health check passes
  - Parameters: `serviceName: string`, `status: HealthStatus`
  
- **serviceUnhealthy**: Emitted when initial health check fails
  - Parameters: `serviceName: string`, `status: HealthStatus`

## Integration with ToolRouter (Task 13)

When implementing the ToolRouter, follow this pattern:

### 1. Service Registration Flow

```typescript
// In ToolRouter or service initialization code:

// 1. Register service with ServiceRegistry
await serviceRegistry.register(serviceDefinition);

// 2. Create connection pool
const pool = new ConnectionPool(serviceDefinition, poolConfig);

// 3. Register with HealthMonitor and get initial health status
const healthStatus = await healthMonitor.registerConnectionPool(
  serviceDefinition.name, 
  pool
);

// 4. Only enable tools if service is healthy
if (healthStatus.healthy) {
  // Discover and enable tools for this service
  await toolRouter.discoverToolsForService(serviceDefinition.name);
} else {
  // Log that service is unhealthy and tools are not enabled
  console.warn(
    `Service ${serviceDefinition.name} failed initial health check. ` +
    `Tools will not be enabled until service becomes healthy.`
  );
}
```

### 2. Health Status Change Handling

Subscribe to health status changes to automatically enable/disable tools:

```typescript
// Subscribe to health status changes
healthMonitor.onHealthChange((status: HealthStatus) => {
  if (status.healthy) {
    // Service recovered - enable tools
    toolRouter.enableToolsForService(status.serviceName);
  } else {
    // Service became unhealthy - disable tools
    toolRouter.disableToolsForService(status.serviceName);
  }
});

// Or use specific events:
healthMonitor.on('serviceRecovered', async (serviceName: string) => {
  await toolRouter.enableToolsForService(serviceName);
});

healthMonitor.on('serviceFailed', async (serviceName: string) => {
  await toolRouter.disableToolsForService(serviceName);
});
```

### 3. Tool Discovery Considerations

When discovering tools for a service:

1. Check the service's current health status before discovery
2. Only include tools from healthy services in the tool list
3. Cache tool definitions but mark them as unavailable if service is unhealthy

```typescript
async discoverTools(): Promise<Tool[]> {
  const services = await serviceRegistry.list();
  const tools: Tool[] = [];
  
  for (const service of services) {
    if (!service.enabled) continue;
    
    // Check health status
    const healthStatus = healthMonitor.getHealthStatus(service.name);
    
    // Only discover tools from healthy services
    if (healthStatus && healthStatus.healthy) {
      const serviceTools = await this.discoverToolsForService(service.name);
      tools.push(...serviceTools);
    }
  }
  
  return tools;
}
```

## Testing

The implementation includes comprehensive tests in `tests/unit/health/health-monitor.test.ts`:

- Initial health check is performed on registration
- Events are emitted correctly based on health status
- Health status is available immediately after registration
- Both healthy and unhealthy scenarios are tested

## Requirements Satisfied

- **Requirement 20.9**: "THE Router_System SHALL 在 Service 首次注册后执行初始健康检查，在健康检查通过前不启用其工具"
  - Initial health check is performed when connection pool is registered
  - Health status is returned, allowing caller to decide whether to enable tools
  - Events are emitted to notify other components of health status

## Next Steps

When implementing Task 13 (Tool Router):

1. Use the pattern described above to integrate with HealthMonitor
2. Implement tool enabling/disabling based on health status
3. Subscribe to health change events for automatic tool management
4. Ensure tools are only discoverable when their service is healthy
