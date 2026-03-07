/**
 * MCP Router System - Optimized TUI Application
 *
 * Enhanced version with better UX, visual feedback, and navigation
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
import { Header } from './components/Header.js';
import { StatusBar, type StatusMessage } from './components/StatusBar.js';
import { HelpDialog } from './components/HelpDialog.js';
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
type ViewState = 'list' | 'add' | 'edit' | 'tools' | 'help';

/**
 * Main TUI Application Component (Optimized)
 */
export const TuiAppOptimized: React.FC<TuiAppProps> = ({ 
  configDir, 
  config: propConfig, 
  configProvider: propConfigProvider 
}) => {
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
  const [useUnifiedForm, setUseUnifiedForm] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const terminalHeight = stdout?.rows || 24;

  // Calculate global tool statistics
  const globalToolStats = React.useMemo(() => {
    let totalTools = 0;
    let enabledTools = 0;

    services.forEach(service => {
      // Use discovered tool count if available
      const serviceTotal = service.discoveredToolsCount ?? 
        (service.toolStates ? Object.keys(service.toolStates).length : 0);
      
      totalTools += serviceTotal;
      
      // Count explicitly disabled tools
      if (service.toolStates) {
        const disabledCount = Object.entries(service.toolStates)
          .filter(([_, enabled]) => enabled === false).length;
        enabledTools += (serviceTotal - disabledCount);
      } else {
        // If no toolStates, all tools are enabled by default
        enabledTools += serviceTotal;
      }
    });

    return { enabled: enabledTools, total: totalTools };
  }, [services]);

  // Load configuration on mount
  useEffect(() => {
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

        setServiceRegistry(registry);
        if (!config) setConfig(loadedConfig);
        setServices(serviceList);
        setState('ready');
        setLastRefresh(new Date());
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setState('error');
      }
    };

    loadConfig();
  }, [configDir, propConfig, propConfigProvider]);

  // Reload services
  const reloadServices = async () => {
    if (serviceRegistry) {
      try {
        const serviceList = await serviceRegistry.list();
        setServices(serviceList);
        setLastRefresh(new Date());
        
        // Reset selection if out of bounds
        if (selectedIndex >= serviceList.length && serviceList.length > 0) {
          setSelectedIndex(serviceList.length - 1);
        }
        
        setStatusMessage({
          type: 'success',
          message: 'Services refreshed',
          duration: 2000,
        });
      } catch (err) {
        setStatusMessage({
          type: 'error',
          message: `Failed to refresh: ${err instanceof Error ? err.message : String(err)}`,
          duration: 3000,
        });
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
        duration: 3000,
      });
    } catch (err) {
      setStatusMessage({
        type: 'error',
        message: `Failed to save service: ${err instanceof Error ? err.message : String(err)}`,
        duration: 5000,
      });
    }
  };

  // Handle service form cancellation
  const handleServiceCancel = () => {
    setView('list');
    setEditingService(undefined);
    setStatusMessage({
      type: 'info',
      message: 'Operation cancelled',
      duration: 2000,
    });
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
        const services = config.services.map(s => 
          s.name === editingService.name ? updatedService : s
        );
        const newConfig = { ...config, services };
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
        duration: 2000,
      });
    } catch (err) {
      setStatusMessage({
        type: 'error',
        message: `Failed to toggle tool: ${err instanceof Error ? err.message : String(err)}`,
        duration: 3000,
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
        const services = config.services.map(s => 
          s.name === editingService.name ? updatedService : s
        );
        const newConfig = { ...config, services };
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
        duration: 2000,
      });
    } catch (err) {
      setStatusMessage({
        type: 'error',
        message: `Failed to update tools: ${err instanceof Error ? err.message : String(err)}`,
        duration: 3000,
      });
    }
  };

  // Handle tools discovered
  const handleToolsDiscovered = async (toolCount: number) => {
    if (!config || !configProvider || !editingService) return;
    
    // Only update if the count has changed
    if (editingService.discoveredToolsCount === toolCount) return;

    try {
      const updatedService = { ...editingService, discoveredToolsCount: toolCount };
      
      if (serviceRegistry) {
        await serviceRegistry.register(updatedService);
      } else {
        const services = config.services.map(s => 
          s.name === editingService.name ? updatedService : s
        );
        const newConfig = { ...config, services };
        await configProvider.save(newConfig);
      }
      
      // Update editing service
      setEditingService(updatedService);
      
      // Update services list
      setServices(prevServices => 
        prevServices.map(s => 
          s.name === editingService.name ? updatedService : s
        )
      );
    } catch (err) {
      // Silently fail - this is not critical
      console.error('Failed to save discovered tool count:', err);
    }
  };

  // Handle service toggle
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
        duration: 2000,
      });
    } catch (err) {
      setStatusMessage({
        type: 'error',
        message: `Failed to toggle service: ${err instanceof Error ? err.message : String(err)}`,
        duration: 3000,
      });
    }
  };

  // Handle service deletion
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
        duration: 2000,
      });
    } catch (err) {
      setStatusMessage({
        type: 'error',
        message: `Failed to delete service: ${err instanceof Error ? err.message : String(err)}`,
        duration: 3000,
      });
    }
  };

  // Handle keyboard input
  useInput((input, key) => {
    if (state !== 'ready') return;

    // Global help shortcut
    if (input === '?' && view !== 'help') {
      setView('help');
      return;
    }

    // Help view
    if (view === 'help') {
      if (key.escape || input === '?' || input === 'q') {
        setView('list');
      }
      return;
    }

    // Global quit
    if (input === 'q' && view === 'list') {
      process.exit(0);
    }

    // Tools view
    if (view === 'tools') {
      if (key.escape) {
        setView('list');
        setRefreshKey(k => k + 1);
      }
      return;
    }

    // Form views
    if (view === 'add' || view === 'edit') {
      // Forms handle their own input
      return;
    }

    // List view navigation
    if (view === 'list') {
      if (key.upArrow) {
        setSelectedIndex(prev => Math.max(0, prev - 1));
      } else if (key.downArrow) {
        setSelectedIndex(prev => Math.min(services.length - 1, prev + 1));
      } else if (key.return) {
        if (services[selectedIndex]) {
          setEditingService(services[selectedIndex]);
          setView('edit');
        }
      } else if (input === 'a') {
        setEditingService(undefined);
        setView('add');
      } else if (input === 'e') {
        if (services[selectedIndex]) {
          setEditingService(services[selectedIndex]);
          setView('edit');
        }
      } else if (input === 'v') {
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
      } else if (input === 'r') {
        reloadServices();
      } else if (input === 'y') {
        setUseUnifiedForm(!useUnifiedForm);
        setStatusMessage({
          type: 'info',
          message: `Switched to ${!useUnifiedForm ? 'unified' : 'traditional'} form mode`,
          duration: 2000,
        });
      }
    }
  });

  // Render loading state
  if (state === 'loading') {
    return (
      <Box flexDirection="column" padding={1}>
        <Header title="MCP Router System" subtitle="Loading..." />
        <Box borderStyle="single" padding={1}>
          <Text color="cyan">⏳ Loading configuration...</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Configuration directory: {configDir}</Text>
        </Box>
      </Box>
    );
  }

  // Render error state
  if (state === 'error') {
    return (
      <Box flexDirection="column" padding={1}>
        <Header title="MCP Router System" subtitle="Error" />
        <Box borderStyle="double" borderColor="red" padding={1} flexDirection="column">
          <Text bold color="red">❌ Error loading configuration</Text>
          <Text color="red">{error}</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Configuration directory: {configDir}</Text>
        </Box>
        <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
          <Text dimColor>Press Ctrl+C to exit</Text>
        </Box>
      </Box>
    );
  }

  // Render help view
  if (view === 'help') {
    return <HelpDialog onClose={() => setView('list')} />;
  }

  const enabledServices = services.filter(s => s.enabled).length;
  const formMode = useUnifiedForm ? 'Unified' : 'Traditional';

  // Render main application
  return (
    <Box flexDirection="column" height={terminalHeight}>
      <Header
        title="MCP Router System"
        subtitle="Configuration Manager"
        stats={[
          { label: 'Services', value: services.length, color: 'yellow' },
          { label: 'Enabled', value: enabledServices, color: 'green' },
          { label: 'Mode', value: config?.mode || 'unknown', color: 'blue' },
          { label: 'Form', value: formMode, color: 'magenta' },
        ]}
        showHelp={view === 'list'}
      />

      <StatusBar 
        message={statusMessage} 
        onClear={() => setStatusMessage(null)} 
      />

      <Box flexDirection="column" flexGrow={1}>
        {view === 'list' && (
          <ServiceList
            key={refreshKey}
            services={services}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
            onToggleService={handleToggleService}
            onDeleteService={handleDeleteService}
            showDetails={true}
            globalToolStats={globalToolStats}
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
      </Box>

      {view === 'list' && (
        <Box marginTop={1}>
          <Text dimColor>
            Last refresh: {lastRefresh.toLocaleTimeString()} • 
            Config: {configDir}
          </Text>
        </Box>
      )}
    </Box>
  );
};
