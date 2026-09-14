/** Simple Dock node half: settings namespace + cost engine + cost endpoint. */
import type { Context } from '@deepseek-ai/cordis';

/** Cost breakdown for one currency, per 1M-token rates. */
export interface CostBreakdown {
  readonly hit: number;
  readonly miss: number;
  readonly out: number;
  readonly total: number;
}
/** Totals keyed by the currencies the engine prices. */
export type CostTotals = Record<string, CostBreakdown>;
/** One usage-bearing assistant step read from a stored session log. */
export interface StepUsageRow {
  readonly seq: number | null;
  readonly time: number | null;
  readonly model: string | null;
  readonly uncached: number;
  readonly read: number;
  readonly write: number;
  readonly out: number;
}
/** One session's priced cost plus the steps not yet written to its log. */
export interface SessionCostEntry {
  readonly id: string;
  readonly header: { readonly parentSession: string | null; readonly origin: string | null; readonly version: number | null };
  seq: number | null;
  steps: number;
  totals: CostTotals;
  pending: readonly unknown[];
  unpriced: number;
}
/** Project stored session events onto per-step usage rows. */
export declare function stepsFromEvents(events: readonly unknown[]): StepUsageRow[];
/** Price one step in every currency; null when no currency knows the model. */
export declare function costOfStep(step: StepUsageRow): CostTotals | null;
/** Zero totals across every priced currency. */
export declare function zeroTotals(): CostTotals;
/** Add one step's per-currency cost onto running totals. */
export declare function addTotals(totals: CostTotals, stepCost: CostTotals | null): CostTotals;
/** Newest usable cost record in a log, or null ({} when absent). */
export declare function baselineFromEvents(events: readonly unknown[]): { seq: number | null; steps: number; totals: CostTotals } | null;
/** Full backfill (no cost record) or incremental pricing from the baseline. */
export declare function entryFromEvents(id: string, header: unknown, events: readonly unknown[]): SessionCostEntry;
/** Accumulate one live step; false when it was already priced. */
export declare function applyLiveStep(entry: SessionCostEntry, step: StepUsageRow): boolean;
/** Merge a session with every descendant reached through header.parentSession. */
export declare function mergeLineage(entries: Map<string, SessionCostEntry>, id: string): { steps: number; totals: CostTotals; subagents: { sessions: number; steps: number; totals: CostTotals } };
/**
 * Register the settings namespace, warm/price every stored session, persist
 * each priced step as an ignorable 'simple-dock/cost' session event, and serve
 * GET /dsh-simple-dock/api/cost?sessionId=&lt;id&gt;[&refresh=1].
 */
export declare function apply(ctx: Context): void;
