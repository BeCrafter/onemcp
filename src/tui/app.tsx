/**
 * MCP Router System - TUI Main Application Component
 *
 * This is the root component for the TUI application.
 * It manages the overall application state and navigation.
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { FileConfigProvider } from '../config/file-provider.js';
import { FileStorageAdapter } from '../storage/file.js';
import { ServiceRegistry } from '../registry/service-registry.js';
import { ServiceList } from './components/ServiceList.js';
import { ServiceForm } from './components/ServiceForm.js';
import { ServiceFormUnified } from './components/ServiceFormUnified.js';
import { ServiceTools } from './components/ServiceTools.js';
import type { SystemConfig, ConfigProvider } from '../types/config.js';
import type { ServiceDefinition } from '../types/service.js';

/**
 * TUI Application Props
 */
export interface TuiAppProps {
  configDir?: string;
  config?: SystemConfig;
  configProvider?: ConfigProvider;
}

/**
 * Application state
 */
type AppState = 'loading' | 'ready' | 'error';

/**
 * View state
 */
type ViewState = 'list' | 'add' | 'edit' | 'delete' | 'test' | 'tools';

/**
 * Status message
 */
interface StatusMessage {
  type: 'success' | 'error' | 'info';
  message: string;
  duration?: number;
}

/**
 * Main TUI Application Component
 */
export const TuiApp: React.FC<TuiAppProps> = ({ configDir, config: propConfig, configProvider: propConfigProvider }) => {
  const { stdout } = useStdout();
  const [state, setState] = useState<AppState>('loading');
  const [view, setView] = useState<ViewState>('list');
  const [config, setConfig] = useState<SystemConfig | null>(propConfig || null);
  const [configProvider, setConfigProvider] = useState<ConfigProvider | null>(propConfigProvider || null);
  const [services, setServices] = useState<ServiceDefinition[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [serviceRegistry, setServiceRegistry] = useState<ServiceRegistry | null>(null);
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null);
  const [editingService, setEditingService] = useState<ServiceDefinition | undefined>(undefined);
  const [refreshKey, setRefreshKey] = useState(0);
  const [useUnifiedForm, setUseUnifiedForm] = useState(true); // Use unified form by default

  const terminalHeight = stdout?.rows || 24;

  // Calculate global tool statistics
  const globalToolStats = React.useMemo(() => {
    let totalTools = 0;
    let enabledTools = 0;

    services.forEach(service => {
      if (service.enabled && service.toolStates) {
        const toolCount = Object.keys(service.toolStates).length;
        totalTools += toolCount;
        const disabledCount = Object.values(service.toolStates)
          .filter(v => v === false).length;
        enabledTools += Math.max(0, toolCount - disabledCount);
      }
    });

    return { enabled: enabledTools, total: totalTools };
  }, [services]);

  // Load configuration on mount
  useEffect(() => {
    let unwatch: (() => void) | null = null;
    
    const loadConfig = async () => {
      try {
        let loadedConfig = config;
        let provider = configProvider;

        if (!loadedConfig || !provider) {
          const dir = configDir || propConfig?.configDir || '';
          const storage = new FileStorageAdapter(dir);
          provider = new FileConfigProvider({
            storageAdapter: storage,
            configDir: dir,
          });
          loadedConfig = await provider.load();
          
          const validation = provider.validate(loadedConfig);
          if (!validation.valid) {
            const errorMessages = validation.errors.map(e => `${e.field}: ${e.message}`).join(', ');
            throw new Error(`Configuration validation failed: ${errorMessages}`);
          }
          
          setConfigProvider(provider);
        }

        const registry = new ServiceRegistry(provider);
        await registry.initialize();
        
        const serviceList = await registry.list();
        
        unwatch = provider.watch((newConfig) => {
          const updatedServices = Object.entries(newConfig.mcpServers).map(([name, def]) => ({ ...def, name }));
          setServices(updatedServices);
          
          if (serviceRegistry) {
            serviceRegistry.initialize().catch(console.error);
          }
          
          setStatusMessage({
            type: 'info',
            message: 'Configuration updated from external changes',
            duration: 3000,
          });
        });
        
        setServiceRegistry(registry);
        if (!config) setConfig(loadedConfig);
        setServices(serviceList);
        setState('ready');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setState('error');
      }
    };

    loadConfig();
    
    return () => {
      if (unwatch) {
        unwatch();
      }
    };
  }, [configDir, propConfig, propConfigProvider]);

  // Reload services when registry changes
  const reloadServices = async () => {
    if (serviceRegistry) {
      const serviceList = await serviceRegistry.list();
      setServices(serviceList);
      // Reset selection if out of bounds
      if (selectedIndex >= serviceList.length && serviceList.length > 0) {
        setSelectedIndex(serviceList.length - 1);
      }
    }
  };

  // Handle service form submission
  const handleServiceSubmit = async (service: ServiceDefinition) => {
    if (!serviceRegistry) return;

    try {
      // Check if this is a rename operation (editing service with name change)
      if (editingService && editingService.name !== service.name) {
        // Delete the old service first
        await serviceRegistry.unregister(editingService.name);
      }
      
      // Register the new/updated service
      await serviceRegistry.register(service);
      await reloadServices();
      setView('list');
      setEditingService(undefined);
      setStatusMessage({
        type: 'success',
        message: `Service '${service.name}' ${editingService ? 'updated' : 'created'} successfully`,
      });
      // Clear status message after 3 seconds
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (err) {
      setStatusMessage({
        type: 'error',
        message: `Failed to save service: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  // Handle service form cancellation
  const handleServiceCancel = () => {
    setView('list');
    setEditingService(undefined);
  };

  // Handle tool toggle
  const handleToggleTool = async (toolName: string, enabled: boolean) => {
    if (!config || !configProvider || !editingService) return;

    try {
      const toolStates = editingService.toolStates || {};
      const newToolStates = { ...toolStates, [toolName]: enabled };
      
      const updatedService = { ...editingService, toolStates: newToolStates };
      
      if (serviceRegistry) {
        await serviceRegistry.register(updatedService);
      } else {
        const newServers = { ...config.mcpServers };
        const { name: _n, ...def } = updatedService;
        newServers[updatedService.name] = def;
        const newConfig = { ...config, mcpServers: newServers };
        await configProvider.save(newConfig);
      }

      // Update editing service
      setEditingService(updatedService);

      // Update services list to reflect the change immediately
      setServices(prevServices =>
        prevServices.map(s => 
          s.name === editingService.name ? updatedService : s
        )
      );
      
      setStatusMessage({
        type: 'success',
        message: `Tool '${toolName}' ${enabled ? 'enabled' : 'disabled'}`,
      });
      setTimeout(() => setStatusMessage(null), 2000);
    } catch (err) {
      setStatusMessage({
        type: 'error',
        message: `Failed to toggle tool: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  const handleBatchToggleTools = async (toolStates: Record<string, boolean>) => {
    if (!config || !configProvider || !editingService) return;

    try {
      const currentToolStates = editingService.toolStates || {};
      const newToolStates = { ...currentToolStates, ...toolStates };
      
      const updatedService = { ...editingService, toolStates: newToolStates };
      
      if (serviceRegistry) {
        await serviceRegistry.register(updatedService);
      } else {
        const newServers = { ...config.mcpServers };
        const { name: _nn, ...def2 } = updatedService;
        newServers[updatedService.name] = def2;
        const newConfig = { ...config, mcpServers: newServers };
        await configProvider.save(newConfig);
      }

      setEditingService(updatedService);
      setServices(prevServices =>
        prevServices.map(s =>
          s.name === editingService.name ? updatedService : s
        )
      );
      
      setStatusMessage({
        type: 'success',
        message: `Updated ${Object.keys(toolStates).length} tool(s)`,
        duration: 3000
      });
    } catch (err) {
      setStatusMessage({
        type: 'error',
        message: `Failed to update tools: ${err instanceof Error ? err.message : String(err)}`,
        duration: 5000
      });
    }
  };

  // Handle tools discovered — in-memory only, no persistence
  const handleToolsDiscovered = (_toolCount: number) => {
    // Tool counts are not persisted in this legacy TUI
  };

  const handleToggleService = async (serviceName: string, enabled: boolean) => {
    if (!config || !configProvider) return;

    try {
      const updatedServices = services.map(s => 
        s.name === serviceName ? { ...s, enabled } : s
      );
      const newConfig = { ...config, services: updatedServices };
      await configProvider.save(newConfig);
      
      if (serviceRegistry) {
        await serviceRegistry.register(updatedServices.find(s => s.name === serviceName)!);
      }
      
      setServices(updatedServices);
      setStatusMessage({
        type: 'success',
        message: `Service '${serviceName}' ${enabled ? 'enabled' : 'disabled'}`,
        duration: 3000
      });
    } catch (err) {
      setStatusMessage({
        type: 'error',
        message: `Failed to toggle service: ${err instanceof Error ? err.message : String(err)}`,
        duration: 5000
      });
    }
  };

  const handleDeleteService = async (serviceName: string) => {
    if (!config || !configProvider) return;

    try {
      // Unregister from service registry first
      if (serviceRegistry) {
        await serviceRegistry.unregister(serviceName);
      } else {
        // Fallback: update config directly
        const updatedServices = services.filter(s => s.name !== serviceName);
        const newConfig = { ...config, services: updatedServices };
        await configProvider.save(newConfig);
      }
      
      // Update local state
      const updatedServices = services.filter(s => s.name !== serviceName);
      setServices(updatedServices);
      if (selectedIndex >= updatedServices.length && updatedServices.length > 0) {
        setSelectedIndex(updatedServices.length - 1);
      }
      setStatusMessage({
        type: 'success',
        message: `Service '${serviceName}' deleted`,
        duration: 3000
      });
    } catch (err) {
      setStatusMessage({
        type: 'error',
        message: `Failed to delete service: ${err instanceof Error ? err.message : String(err)}`,
        duration: 5000
      });
    }
  };

  // Handle keyboard input
  useInput((input, key) => {
    if (state !== 'ready') return;

    // Global shortcuts
    if (input === 'q' && view === 'list') {
      process.exit(0);
    }
    
    if (input === '?') {
      setStatusMessage({
        type: 'info',
        message: 'Help: ?=help, q=quit, ↑↓=navigate, Enter=edit, Space=toggle, T=tools, D=delete',
        duration: 5000
      });
      return;
    }

    // Tools view - handle back
    if (view === 'tools') {
      if (key.escape) {
        setView('list');
        setRefreshKey(k => k + 1);
      }
      return;
    }

    // List view navigation
    if (view === 'list') {
      if (key.upArrow) {
        setSelectedIndex(prev => Math.max(0, prev - 1));
      } else if (key.downArrow) {
        setSelectedIndex(prev => Math.min(services.length - 1, prev + 1));
      } else if (input === ' ') {
        if (services[selectedIndex]) {
          const service = services[selectedIndex];
          handleToggleService(service.name, !service.enabled);
        }
      } else if (input === 't' || input === 'T') {
        if (services[selectedIndex]) {
          setEditingService(services[selectedIndex]);
          setView('tools');
        }
      } else if (input === 'd' || input === 'D') {
        if (services[selectedIndex]) {
          const service = services[selectedIndex];
          handleDeleteService(service.name);
        }
      } else if (key.return) {
        if (services[selectedIndex]) {
          setEditingService(services[selectedIndex]);
          setView('edit');
        }
      } else if (input === 'a') {
        // Add service
        setEditingService(undefined);
        setView('add');
      } else if (input === 'e') {
        // Edit service
        if (services[selectedIndex]) {
          setEditingService(services[selectedIndex]);
          setView('edit');
        }
      } else if (input === 'v') {
        // View tools for selected service
        if (services[selectedIndex]) {
          setEditingService(services[selectedIndex]);
          setView('tools');
        }
      } else if (input === ' ' || input === 't') {
        if (services[selectedIndex]) {
          const service = services[selectedIndex];
          handleToggleService(service.name, !service.enabled);
        }
      } else if (input === 'd') {
        if (services[selectedIndex]) {
          const service = services[selectedIndex];
          handleDeleteService(service.name);
        }
      } else if (input === 'y') {
        // Toggle form mode
        setUseUnifiedForm(!useUnifiedForm);
      }
    }
    
    if (view === 'add' || view === 'edit') {
      // Allow help shortcut from forms
      if (input === '?') {
        setStatusMessage({
          type: 'info',
          message: 'Help: ?=help, q=quit, ↑↓=navigate, Enter=edit, Space=toggle, T=tools, D=delete',
          duration: 5000
        });
        return;
      }
      
      // Allow quit shortcut from forms
      if (input === 'q') {
        process.exit(0);
      }
      
      // Allow refresh shortcut from forms
      if (input === 'r') {
        reloadServices();
        return;
      }
      
      // Forms handle other input
      return;
    }
  });

  // Render loading state
  if (state === 'loading') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan">Loading configuration...</Text>
        <Text dimColor>Configuration directory: {configDir}</Text>
      </Box>
    );
  }

  // Render error state
  if (state === 'error') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red" bold>Error loading configuration</Text>
        <Text color="red">{error}</Text>
        <Box marginTop={1}>
          <Text dimColor>Configuration directory: {configDir}</Text>
        </Box>
        <Box marginTop={1}>
          <Text>Press Ctrl+C to exit</Text>
        </Box>
      </Box>
    );
  }

  // Render main application
  return (
    <Box flexDirection="column" height={terminalHeight}>
      <Box borderStyle="round" borderColor="cyan" padding={1} marginBottom={1}>
        <Text bold color="cyan">MCP Router System - Configuration Manager</Text>
      </Box>
      
      <Box flexDirection="column" marginBottom={1}>
        <Text>Configuration directory: <Text color="green">{configDir}</Text></Text>
        <Text>Services: <Text color="yellow">{services.length}</Text></Text>
        <Text>Mode: <Text color="blue">{config?.mode || 'unknown'}</Text></Text>
      </Box>

      {/* Status message */}
      {statusMessage && (
        <Box
          borderStyle="single"
          borderColor={statusMessage.type === 'error' ? 'red' : statusMessage.type === 'success' ? 'green' : 'blue'}
          padding={1}
          marginBottom={1}
        >
          <Text color={statusMessage.type === 'error' ? 'red' : statusMessage.type === 'success' ? 'green' : 'blue'}>
            {statusMessage.type === 'error' ? '✗' : statusMessage.type === 'success' ? '✓' : 'ℹ'} {statusMessage.message}
          </Text>
        </Box>
      )}

      <Box flexDirection="column" flexGrow={1}>
        {view === 'list' && (
          <ServiceList
            key={refreshKey}
            services={services}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
            globalToolStats={globalToolStats}
            terminalHeight={terminalHeight}
          />
        )}

        {(view === 'add' || view === 'edit') && (
          useUnifiedForm ? (
            <ServiceFormUnified
              service={editingService}
              onSubmit={handleServiceSubmit}
              onCancel={handleServiceCancel}
            />
          ) : (
            <ServiceForm
              service={editingService}
              onSubmit={handleServiceSubmit}
              onCancel={handleServiceCancel}
            />
          )
        )}

        {view === 'tools' && editingService && (
          <ServiceTools
            service={editingService}
            onBack={() => setView('list')}
            onToggleTool={handleToggleTool}
            onBatchToggleTools={handleBatchToggleTools}
            toolStates={editingService.toolStates || {}}
            onToolsDiscovered={handleToolsDiscovered}
          />
        )}

        {view !== 'list' && view !== 'add' && view !== 'edit' && view !== 'tools' && (
          <Box borderStyle="single" padding={1} marginBottom={1}>
            <Text dimColor>View '{view}' is being implemented...</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};
