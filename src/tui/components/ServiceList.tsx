/**
 * Service List Component
 *
 * Displays all registered services with their status and details.
 * Supports navigation and selection with enhanced visual feedback.
 *
 * Every service renders on EXACTLY one line: the endpoint/tags are truncated to
 * a computed cell budget instead of wrapping. Wrapping was what pushed the frame
 * past the terminal (rows can be 2-3 lines when an endpoint is long), and a frame
 * taller than the viewport makes ink's absolute writes land on the wrong rows.
 *
 * The row budget the host passes in (`terminalHeight`) is consumed by
 * LIST_CHROME_LINES + the item rows + the pager row. Counting the chrome wrong
 * by even one row is what made a full list overflow a 24-row terminal.
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { useTerminalSize } from '../use-terminal-size.js';
import { truncateDisplay } from '../text-layout.js';
import type { ServiceDefinition } from '../../types/service.js';
import type { DiscoveryStatus } from '../tool-discovery-manager.js';

export interface ServiceListProps {
  services: ServiceDefinition[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  terminalHeight?: number;
  discoveryStatus?: Map<string, DiscoveryStatus>;
  toolCounts?: Map<string, number>;
}

/** Column budgets derived from the terminal width. */
export interface ListColumnLayout {
  nameWidth: number;
  transportWidth: number;
  endpointWidth: number;
  /** null → the tags column is dropped to keep the endpoint readable. */
  tagWidth: number | null;
  /** null → the tool-count column is dropped. */
  toolWidth: number | null;
}

const MARKER_WIDTH = 3;
const TRANSPORT_WIDTH = 8;
const DEFAULT_NAME_WIDTH = 25;
const DEFAULT_TAG_WIDTH = 28;
/** Wide enough for the worst label the column draws: `117/120 tools`. */
const DEFAULT_TOOL_WIDTH = 13;
const MIN_NAME_WIDTH = 10;
/** Below this the endpoint stops being readable, so columns get dropped instead. */
const MIN_ENDPOINT_WIDTH = 10;

/**
 * Footer hints, most-needed first: a narrow terminal loses them from the tail
 * instead of having the row cut mid-word by `wrap="truncate"` — at 80 columns
 * that used to hide `q Quit` completely. Whatever is dropped stays reachable
 * through `?`, which the header advertises.
 */
const FOOTER_HINTS = [
  '↑/↓ Move',
  'Enter Edit',
  'Space Toggle',
  'd Delete',
  'v Tools',
  'q Quit',
  'a Add',
  'r Refresh',
] as const;

/** Assemble as many footer hints as the terminal width leaves room for. */
export function footerHint(terminalWidth: number): string {
  const budget = Math.max(12, terminalWidth - 4); // borders (2) + paddingX (2)
  const kept: string[] = [];
  let width = 0;
  for (const [index, hint] of FOOTER_HINTS.entries()) {
    const next = width === 0 ? hint.length : width + 3 + hint.length;
    // Reserve room for the "…" that marks the dropped hints, so the row is
    // either complete or visibly truncated — never silently clipped.
    const room = index < FOOTER_HINTS.length - 1 ? 2 : 0;
    if (kept.length > 0 && next + room > budget) {
      return `${kept.join(' | ')} …`;
    }
    kept.push(hint);
    width = next;
  }
  return kept.join(' | ');
}

/**
 * Split the horizontal budget between columns, dropping the optional ones
 * (tags, then tool counts) before letting the endpoint collapse to nothing.
 */
export function computeColumnLayout(terminalWidth: number): ListColumnLayout {
  const inner = Math.max(20, terminalWidth - 4); // borders (2) + paddingX (2)
  const fixed = MARKER_WIDTH + TRANSPORT_WIDTH;
  let nameWidth = DEFAULT_NAME_WIDTH;
  let tagWidth: number | null = DEFAULT_TAG_WIDTH;
  let toolWidth: number | null = DEFAULT_TOOL_WIDTH;

  const endpointIfKept = (): number =>
    inner - fixed - nameWidth - (tagWidth ?? 0) - (toolWidth ?? 0);

  if (endpointIfKept() < MIN_ENDPOINT_WIDTH) {
    tagWidth = null;
  }
  if (endpointIfKept() < MIN_ENDPOINT_WIDTH) {
    toolWidth = null;
  }
  if (endpointIfKept() < MIN_ENDPOINT_WIDTH) {
    const deficit = MIN_ENDPOINT_WIDTH - endpointIfKept();
    nameWidth -= Math.min(deficit, nameWidth - MIN_NAME_WIDTH);
  }

  return {
    nameWidth,
    transportWidth: TRANSPORT_WIDTH,
    endpointWidth: Math.max(4, endpointIfKept()),
    tagWidth,
    toolWidth,
  };
}

/**
 * Format transport type with color
 */
function formatTransport(transport: string): { text: string; color: string } {
  switch (transport) {
    case 'stdio':
      return { text: 'stdio', color: 'blue' };
    case 'sse':
      return { text: 'SSE', color: 'magenta' };
    case 'http':
      return { text: 'HTTP', color: 'cyan' };
    default:
      return { text: transport, color: 'gray' };
  }
}

/**
 * Format enabled status with color
 */
function formatEnabled(enabled: boolean): { text: string; color: string; symbol: string } {
  return enabled
    ? { text: 'Enabled', color: 'green', symbol: '+' }
    : { text: 'Disabled', color: 'red', symbol: '-' };
}

/**
 * Service List Item Component — renders exactly one terminal line.
 */
const ServiceListItem: React.FC<{
  service: ServiceDefinition;
  isSelected: boolean;
  layout: ListColumnLayout;
  discoveryStatus?: DiscoveryStatus;
  toolCount?: number;
}> = ({ service, isSelected, layout, discoveryStatus, toolCount }) => {
  const transport = formatTransport(service.transport);
  const status = formatEnabled(service.enabled);

  // Count explicitly disabled tools from toolStates
  const disabledTools = service.toolStates
    ? Object.entries(service.toolStates).filter(([_, enabled]) => enabled === false).length
    : 0;

  const enabledTools = Math.max(0, (toolCount ?? 0) - disabledTools);

  const endpoint =
    service.transport === 'stdio'
      ? (service.command || '') + (service.args?.length ? ' ' + service.args.join(' ') : '')
      : service.url || '';

  const tags = service.tags?.slice(0, 3) ?? [];

  const toolLabel = (): string => {
    if (!service.enabled) {
      return '';
    }
    switch (discoveryStatus) {
      // Scheduled but not started yet — without this the cell is blank, which
      // reads as "this service has no tools" rather than "not asked yet".
      case 'pending':
        return '⏳ queued';
      case 'in-progress':
        return '⏳ loading';
      case 'failed':
        return '✗ failed';
      case 'completed':
        if (toolCount === undefined || toolCount === 0) {
          return '';
        }
        // `5/5 tools` for a service with nothing disabled is noise; the ratio
        // only carries information once something is switched off.
        return disabledTools > 0 ? `${enabledTools}/${toolCount} tools` : `${toolCount} tools`;
      default:
        return '';
    }
  };

  return (
    <Box flexDirection="row" paddingX={1} paddingY={0} marginBottom={0}>
      <Box width={MARKER_WIDTH} flexShrink={0}>
        <Text bold color={isSelected ? 'cyan' : 'gray'}>
          {isSelected ? '▶' : ' '}
        </Text>
      </Box>

      <Box width={layout.nameWidth} flexShrink={0}>
        <Text bold color={status.color}>
          {status.symbol}
        </Text>
        <Text bold color={isSelected ? 'cyan' : 'white'} wrap="truncate">
          {' '}
          {truncateDisplay(service.name, Math.max(1, layout.nameWidth - 2))}
        </Text>
      </Box>

      <Box width={layout.transportWidth} flexShrink={0}>
        <Text color={transport.color} bold wrap="truncate">
          {transport.text}
        </Text>
      </Box>

      <Box width={layout.endpointWidth} flexShrink={0}>
        <Text color="gray" wrap="truncate">
          {truncateDisplay(endpoint, layout.endpointWidth)}
        </Text>
      </Box>

      {layout.tagWidth !== null && (
        <Box width={layout.tagWidth} flexShrink={0} paddingX={1}>
          <Text wrap="truncate">
            {tags.map((tag, index) => (
              <Text key={tag}>
                <Text color="gray">[</Text>
                <Text color="yellow">{tag}</Text>
                <Text color="gray">]</Text>
                {index < tags.length - 1 ? ' ' : ''}
              </Text>
            ))}
          </Text>
        </Box>
      )}

      {layout.toolWidth !== null && (
        <Box width={layout.toolWidth} flexShrink={0} justifyContent="flex-end">
          <Text wrap="truncate">
            <Text color={discoveryStatus === 'failed' ? 'red' : 'magenta'} bold>
              {toolLabel()}
            </Text>
          </Text>
        </Box>
      )}
    </Box>
  );
};

/**
 * Service List Component
 */
export const ServiceList: React.FC<ServiceListProps> = ({
  services,
  selectedIndex,
  onSelect,
  terminalHeight,
  discoveryStatus,
  toolCounts,
}) => {
  const effectiveTerminalHeight = terminalHeight || 24;
  // Subscribes to resize, so the dropped-column layout follows the window.
  const { columns: effectiveTerminalWidth } = useTerminalSize();

  const layout = computeColumnLayout(effectiveTerminalWidth);

  // Rows the list draws AROUND its item rows: the box borders (2) and the footer
  // box (3 — two borders plus its row of hints). The per-page counts line that
  // used to sit above the box is gone: it duplicated the header's stats and cost
  // the row that a full list needed to stay inside a 24-row terminal.
  const LIST_CHROME_LINES = 5;
  const rowsForItems = (withPager: boolean): number =>
    Math.max(1, effectiveTerminalHeight - LIST_CHROME_LINES - (withPager ? 1 : 0));

  const wouldPaginate = Math.ceil(services.length / Math.min(25, rowsForItems(false))) > 1;
  const MAX_VISIBLE_SERVICES = Math.min(25, rowsForItems(wouldPaginate));

  const [currentPage, setCurrentPage] = useState(0);
  const totalPages = Math.ceil(services.length / MAX_VISIBLE_SERVICES);
  const startIndex = currentPage * MAX_VISIBLE_SERVICES;
  const visibleServices = services.slice(startIndex, startIndex + MAX_VISIBLE_SERVICES);

  useEffect(() => {
    const newPage = Math.floor(selectedIndex / MAX_VISIBLE_SERVICES);
    if (newPage !== currentPage && newPage >= 0 && newPage < totalPages) {
      setCurrentPage(newPage);
    }
  }, [selectedIndex, MAX_VISIBLE_SERVICES, totalPages, currentPage]);

  useInput((_input, key) => {
    if (key.leftArrow) {
      if (currentPage > 0) {
        const newPage = currentPage - 1;
        setCurrentPage(newPage);
        onSelect(newPage * MAX_VISIBLE_SERVICES);
      }
    } else if (key.rightArrow) {
      if (currentPage < totalPages - 1) {
        const newPage = currentPage + 1;
        setCurrentPage(newPage);
        onSelect(newPage * MAX_VISIBLE_SERVICES);
      }
    }
  });

  if (services.length === 0) {
    return (
      <Box flexDirection="column">
        <Box borderStyle="double" borderColor="yellow" padding={1} flexDirection="column">
          <Text bold color="yellow">
            📋 No services registered
          </Text>
          <Text color="gray">Get started by adding your first MCP service</Text>
        </Box>

        <Box marginTop={1} borderStyle="single" borderColor="cyan" paddingX={1}>
          <Text>
            <Text color="cyan">a</Text>
            <Text color="gray">: Add service | </Text>
            <Text color="cyan">?</Text>
            <Text color="gray">: Help | </Text>
            <Text color="cyan">q</Text>
            <Text color="gray">: Quit</Text>
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {/* Service list with border */}
      <Box
        width={effectiveTerminalWidth}
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
      >
        {visibleServices.map((service, index) => {
          const svcDiscoveryStatus = discoveryStatus?.get(service.name);
          const svcToolCount = toolCounts?.get(service.name);
          return (
            <ServiceListItem
              key={service.name}
              service={service}
              isSelected={startIndex + index === selectedIndex}
              layout={layout}
              {...(svcDiscoveryStatus !== undefined ? { discoveryStatus: svcDiscoveryStatus } : {})}
              {...(svcToolCount !== undefined ? { toolCount: svcToolCount } : {})}
            />
          );
        })}
      </Box>

      {totalPages > 1 && (
        <Box marginTop={0} paddingX={2} justifyContent="center">
          <Text color="gray">
            <Text bold>
              {currentPage + 1}/{totalPages}
            </Text>
            {/* Only the paging keys here — ↑/↓ is already in the footer. */}
            <Text> | ←/→ Page </Text>
            <Text color="gray">({services.length} services)</Text>
          </Text>
        </Box>
      )}

      {/* Footer with shortcuts */}
      <Box width={effectiveTerminalWidth} borderStyle="single" borderColor="gray" paddingX={1}>
        <Text color="gray" wrap="truncate">
          {footerHint(effectiveTerminalWidth)}
        </Text>
      </Box>
    </Box>
  );
};
