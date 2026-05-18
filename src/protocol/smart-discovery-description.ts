/**
 * Smart Discovery Description Builder
 *
 * Composes the dynamic description for `onemcp__search` in smart-discovery mode.
 * The wrapper hides the raw tool list, so any "trigger condition" written in a
 * downstream tool's description (e.g. "MANDATORY at conversation start",
 * "Must-Check Resource", role-activation phrases) becomes invisible to the LLM
 * unless we project it back onto the wrapper. This module performs that
 * projection using purely heuristic regex extraction — no external calls.
 */

import type { Tool } from '../types/tool.js';
import type { ServiceDefinition } from '../types/service.js';

/** Optional config-side hints for a service when description heuristics are insufficient. */
export interface TriggerHints {
  /** Reason to call search at conversation start (joins PROACTIVE TRIGGERS). */
  onSessionStart?: string;
  /** Reason to call search before conversation ends. */
  onSessionEnd?: string;
  /** Extra trigger phrases the LLM should treat as a search signal. */
  phrases?: string[];
}

export interface TriggerDigest {
  serviceName: string;
  namespacedName: string;
  toolName: string;
  /** Sentences containing MANDATORY/MUST/Must-Check style markers. */
  proactive: string[];
  /** Trigger phrases (quoted samples, "When user…" lines, role activation). */
  triggers: string[];
  /** First sentence of the original description, ≤80 chars. */
  gist: string;
}

const PROACTIVE_MARKER_RE =
  /\b(MANDATORY|MUST(?:\s+(?:run|call|use|check))?|Must-Check|proactively|do\s+NOT\s+skip|do\s+not\s+skip)\b/i;
const PROACTIVE_MARKER_CN = /(必须|务必|强制|开场必须|结束前必须|会话开始|会话结束)/;

const TRIGGER_LINE_RE =
  /^\s*(?:[-*•]\s*)?(?:Trigger[s]?|WHEN TO USE|When user|触发场景|触发条件|Use when|使用场景)\b[:：]?\s*(.*)$/i;

const QUOTED_PHRASE_RE = /["'“”‘’「」『』]([^"'“”‘’「」『』\n]{2,60})["'“”‘’「」『』]/g;

const ROLE_ACTIVATION_RE =
  /(我是|扮演|切换到?|act\s+as|switch\s+(?:to\s+)?role|become\s+a)\s*([一-鿿A-Za-z][一-鿿A-Za-z0-9_-]{0,30})/gi;

const SENTENCE_SPLIT_RE = /(?<=[.!?。！？\n])\s+/;

const MAX_PROACTIVE_PER_TOOL = 2;
const MAX_TRIGGERS_PER_TOOL = 4;
const MAX_PROACTIVE_LINE = 200;
const MAX_TRIGGER_LINE = 120;
const DEFAULT_BUDGET_BYTES = 8000;

function clip(s: string, max: number): string {
  const trimmed = s.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max - 1).trimEnd() + '…';
}

function uniquePush(target: string[], value: string, max: number): void {
  const v = value.trim();
  if (!v) return;
  if (target.includes(v)) return;
  target.push(v);
  if (target.length > max) target.length = max;
}

/**
 * Extract trigger digest from a single tool's description.
 * Pure function — does not mutate the input.
 */
export function extractTriggerDigest(tool: Tool, hints?: TriggerHints): TriggerDigest {
  const desc = tool.description ?? '';
  const proactive: string[] = [];
  const triggers: string[] = [];

  const sentences = desc.split(SENTENCE_SPLIT_RE);
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    if (PROACTIVE_MARKER_RE.test(s) || PROACTIVE_MARKER_CN.test(s)) {
      uniquePush(proactive, clip(s, MAX_PROACTIVE_LINE), MAX_PROACTIVE_PER_TOOL);
    }
  }

  const lines = desc.split(/\r?\n/);
  for (const line of lines) {
    const m = TRIGGER_LINE_RE.exec(line);
    if (m && m[1]) {
      uniquePush(triggers, clip(m[1], MAX_TRIGGER_LINE), MAX_TRIGGERS_PER_TOOL);
    }
  }

  let qm: RegExpExecArray | null;
  QUOTED_PHRASE_RE.lastIndex = 0;
  while ((qm = QUOTED_PHRASE_RE.exec(desc)) !== null) {
    const phrase = qm[1];
    if (!phrase) continue;
    if (/^[A-Z_]{2,}$/.test(phrase)) continue;
    uniquePush(triggers, clip(`"${phrase}"`, MAX_TRIGGER_LINE), MAX_TRIGGERS_PER_TOOL);
  }

  let rm: RegExpExecArray | null;
  ROLE_ACTIVATION_RE.lastIndex = 0;
  while ((rm = ROLE_ACTIVATION_RE.exec(desc)) !== null) {
    uniquePush(triggers, clip(rm[0], MAX_TRIGGER_LINE), MAX_TRIGGERS_PER_TOOL);
  }

  if (hints?.onSessionStart) {
    uniquePush(
      proactive,
      clip(`At conversation start: ${hints.onSessionStart}`, MAX_PROACTIVE_LINE),
      MAX_PROACTIVE_PER_TOOL
    );
  }
  if (hints?.onSessionEnd) {
    uniquePush(
      proactive,
      clip(`Before conversation ends: ${hints.onSessionEnd}`, MAX_PROACTIVE_LINE),
      MAX_PROACTIVE_PER_TOOL
    );
  }
  for (const p of hints?.phrases ?? []) {
    uniquePush(triggers, clip(p, MAX_TRIGGER_LINE), MAX_TRIGGERS_PER_TOOL);
  }

  const firstSentence = (sentences[0] ?? '').replace(/[`*_#>]/g, '').trim();
  const gist = clip(firstSentence || tool.name, 80);

  return {
    serviceName: tool.serviceName,
    namespacedName: tool.namespacedName,
    toolName: tool.name,
    proactive,
    triggers,
    gist,
  };
}

function suggestQuery(digest: TriggerDigest): string {
  const parts = digest.toolName
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return parts.slice(0, 3).join(' ') || digest.toolName;
}

export function buildProactiveSection(digests: TriggerDigest[]): string {
  const lines: string[] = [];
  for (const d of digests) {
    if (d.proactive.length === 0) continue;
    for (const p of d.proactive) {
      lines.push(`- [${d.namespacedName}] ${p} → search: "${suggestQuery(d)}"`);
    }
  }
  if (lines.length === 0) return '';
  return [
    '──────── PROACTIVE TRIGGERS ────────',
    'Call onemcp__search BEFORE responding whenever ANY of these apply:',
    ...lines,
  ].join('\n');
}

export function buildTriggerHintsSection(digests: TriggerDigest[]): string {
  const lines: string[] = [];
  for (const d of digests) {
    if (d.triggers.length === 0) continue;
    const sample = d.triggers.slice(0, 3).join(' / ');
    lines.push(`- [${d.namespacedName}] ${sample} → search: "${suggestQuery(d)}"`);
  }
  if (lines.length === 0) return '';
  return [
    '──────── TRIGGER PHRASES ────────',
    'When the user says any of the following, call onemcp__search first:',
    ...lines,
  ].join('\n');
}

export function buildServiceIndex(digests: TriggerDigest[]): string {
  const byService = new Map<string, TriggerDigest[]>();
  for (const d of digests) {
    const arr = byService.get(d.serviceName) ?? [];
    arr.push(d);
    byService.set(d.serviceName, arr);
  }
  if (byService.size === 0) return '';
  const lines: string[] = ['──────── SERVICE INDEX ────────'];
  const services = Array.from(byService.keys()).sort();
  for (const svc of services) {
    const arr = byService.get(svc) ?? [];
    const names = arr
      .map((d) => d.toolName)
      .slice(0, 12)
      .join(', ');
    lines.push(`• ${svc} (${arr.length} tool${arr.length === 1 ? '' : 's'}) — ${names}`);
  }
  return lines.join('\n');
}

/**
 * Rank digests for budget-bound assembly. Higher = keep first.
 * Tools with proactive markers always win.
 */
function rankDigest(d: TriggerDigest): number {
  let score = 0;
  if (d.proactive.length > 0) score += 1000;
  score += d.triggers.length * 10;
  score += Math.min(d.gist.length, 80) * 0.1;
  return score;
}

/**
 * Compose the final dynamic description for the search wrapper.
 *
 * Layout:
 *   <preamble>
 *
 *   PROACTIVE TRIGGERS (only if any tool surfaced markers)
 *   TRIGGER PHRASES   (only if any tool surfaced phrases)
 *   SERVICE INDEX     (always, when ≥1 tool)
 *
 * Length is capped at `budgetBytes` (UTF-16 char count, ~bytes for ASCII).
 * Lower-ranked digests are dropped first; the preamble and section headers are
 * never truncated.
 */
export function buildSmartDiscoverySearchDescription(
  preamble: string,
  tools: Tool[],
  serviceHints?: Record<string, TriggerHints>,
  budgetBytes: number = DEFAULT_BUDGET_BYTES
): string {
  if (tools.length === 0) return preamble;

  const digests = tools
    .map((t) => extractTriggerDigest(t, serviceHints?.[t.serviceName]))
    .sort(
      (a, b) => rankDigest(b) - rankDigest(a) || a.namespacedName.localeCompare(b.namespacedName)
    );

  const tryAssemble = (selected: TriggerDigest[]): string => {
    const sections = [
      preamble,
      buildProactiveSection(selected),
      buildTriggerHintsSection(selected),
      buildServiceIndex(selected),
    ].filter((s) => s.length > 0);
    return sections.join('\n\n');
  };

  const working = digests.slice();
  let assembled = tryAssemble(working);
  while (assembled.length > budgetBytes && working.length > 1) {
    let dropIndex = -1;
    for (let i = working.length - 1; i >= 0; i--) {
      const d = working[i];
      if (d && d.proactive.length === 0) {
        dropIndex = i;
        break;
      }
    }
    if (dropIndex === -1) {
      working.pop();
    } else {
      working.splice(dropIndex, 1);
    }
    assembled = tryAssemble(working);
  }

  return assembled;
}

/**
 * Collect per-service triggerHints declared in `mcpServers[name].triggerHints`
 * into a `serviceName → TriggerHints` map suitable for
 * `ToolDiscoveryConfig.serviceTriggerHints`.
 *
 * Pure function; safe to call at runner construction time.
 */
export function collectServiceTriggerHints(
  mcpServers: Record<string, Omit<ServiceDefinition, 'name'>>
): Record<string, TriggerHints> {
  const out: Record<string, TriggerHints> = {};
  for (const [name, def] of Object.entries(mcpServers)) {
    const hints = def.triggerHints;
    if (!hints) continue;
    const entry: TriggerHints = {};
    if (hints.onSessionStart) entry.onSessionStart = hints.onSessionStart;
    if (hints.onSessionEnd) entry.onSessionEnd = hints.onSessionEnd;
    if (hints.phrases && hints.phrases.length > 0) entry.phrases = [...hints.phrases];
    if (Object.keys(entry).length > 0) {
      out[name] = entry;
    }
  }
  return out;
}
