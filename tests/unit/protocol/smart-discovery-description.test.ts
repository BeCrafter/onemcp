import { describe, it, expect } from 'vitest';
import {
  buildSmartDiscoverySearchDescription,
  collectServiceTriggerHints,
  extractTriggerDigest,
} from '../../../src/protocol/smart-discovery-description.js';
import type { Tool } from '../../../src/types/tool.js';

const PREAMBLE = 'PREAMBLE_TEXT';

function tool(overrides: Partial<Tool>): Tool {
  return {
    name: overrides.name ?? 'demo',
    namespacedName: overrides.namespacedName ?? `svc___${overrides.name ?? 'demo'}`,
    serviceName: overrides.serviceName ?? 'svc',
    description: overrides.description ?? '',
    inputSchema: overrides.inputSchema ?? { type: 'object', properties: {} },
    enabled: overrides.enabled ?? true,
  };
}

describe('extractTriggerDigest', () => {
  it('captures MANDATORY sentences into proactive', () => {
    const t = tool({
      namespacedName: 'prompx___recall',
      name: 'recall',
      serviceName: 'prompx',
      description:
        'Recall role memory. MANDATORY at conversation start when a role is active. Returns engrams.',
    });
    const d = extractTriggerDigest(t);
    expect(d.proactive.some((p) => /MANDATORY/.test(p))).toBe(true);
    expect(d.proactive.some((p) => /conversation start/i.test(p))).toBe(true);
  });

  it('captures Must-Check Resource markers', () => {
    const t = tool({
      namespacedName: 'skill-mcp___skill_list',
      name: 'skill_list',
      serviceName: 'skill-mcp',
      description: 'Must-Check Resource — do NOT skip when answering capability questions.',
    });
    const d = extractTriggerDigest(t);
    expect(d.proactive.length).toBeGreaterThan(0);
    expect(d.proactive[0]).toMatch(/Must-Check|do NOT skip/i);
  });

  it('captures Chinese 必须 markers', () => {
    const t = tool({
      description: '必须在会话开始时调用，否则上下文不全。',
    });
    const d = extractTriggerDigest(t);
    expect(d.proactive.length).toBeGreaterThan(0);
  });

  it('captures Trigger: lines and quoted phrases', () => {
    const t = tool({
      description:
        'Activate a role.\nTrigger: "act as X" or "我是X".\nWhen user says "switch role" call this.',
    });
    const d = extractTriggerDigest(t);
    expect(d.triggers.some((p) => /act as X|我是X/.test(p))).toBe(true);
    expect(d.triggers.length).toBeGreaterThanOrEqual(2);
  });

  it('merges hints into the digest', () => {
    const t = tool({ description: 'Plain description.' });
    const d = extractTriggerDigest(t, {
      onSessionStart: 'always sync memory',
      phrases: ['restore context'],
    });
    expect(d.proactive.some((p) => /always sync memory/.test(p))).toBe(true);
    expect(d.triggers).toContain('restore context');
  });
});

describe('buildSmartDiscoverySearchDescription', () => {
  it('returns preamble unchanged when no tools', () => {
    expect(buildSmartDiscoverySearchDescription(PREAMBLE, [])).toBe(PREAMBLE);
  });

  it('includes PROACTIVE TRIGGERS section when any tool has markers', () => {
    const out = buildSmartDiscoverySearchDescription(PREAMBLE, [
      tool({
        namespacedName: 'prompx___recall',
        name: 'recall',
        serviceName: 'prompx',
        description: 'Recall memory. MANDATORY at conversation start.',
      }),
    ]);
    expect(out).toContain(PREAMBLE);
    expect(out).toContain('PROACTIVE TRIGGERS');
    expect(out).toContain('prompx___recall');
    expect(out).toContain('SERVICE INDEX');
  });

  it('groups SERVICE INDEX by serviceName', () => {
    const out = buildSmartDiscoverySearchDescription(PREAMBLE, [
      tool({ namespacedName: 'a___x', name: 'x', serviceName: 'a' }),
      tool({ namespacedName: 'a___y', name: 'y', serviceName: 'a' }),
      tool({ namespacedName: 'b___z', name: 'z', serviceName: 'b' }),
    ]);
    expect(out).toMatch(/• a \(2 tools\)/);
    expect(out).toMatch(/• b \(1 tool\)/);
  });

  it('respects budget by dropping non-proactive tools first', () => {
    const proactive = tool({
      namespacedName: 'mem___recall',
      name: 'recall',
      serviceName: 'mem',
      description: 'MANDATORY at conversation start. Recall memory.',
    });
    const filler: Tool[] = Array.from({ length: 60 }, (_, i) =>
      tool({
        namespacedName: `bulk___t${i}`,
        name: `t${i}`,
        serviceName: 'bulk',
        description:
          'A long enough description to inflate the index size. '.repeat(8) + `tool ${i} variant.`,
      })
    );
    const out = buildSmartDiscoverySearchDescription(
      PREAMBLE,
      [proactive, ...filler],
      undefined,
      1500
    );
    expect(out.length).toBeLessThanOrEqual(1500 + 200);
    expect(out).toContain('mem___recall');
  });
});

describe('collectServiceTriggerHints', () => {
  it('aggregates triggerHints from mcpServers entries', () => {
    const out = collectServiceTriggerHints({
      prompx: {
        enabled: true,
        tags: [],
        transport: 'http',
        url: 'http://x',
        connectionPool: { maxConnections: 5, idleTimeout: 60000, connectionTimeout: 30000 },
        triggerHints: { onSessionStart: 'recall first', phrases: ['我是X'] },
      },
      plain: {
        enabled: true,
        tags: [],
        transport: 'stdio',
        connectionPool: { maxConnections: 5, idleTimeout: 60000, connectionTimeout: 30000 },
      },
    });
    expect(out['prompx']?.onSessionStart).toBe('recall first');
    expect(out['prompx']?.phrases).toEqual(['我是X']);
    expect(out['plain']).toBeUndefined();
  });
});
