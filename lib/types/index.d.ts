/** Simple Dock node half: settings namespace + same-origin step endpoint. */
import type { Context } from '@deepseek-ai/cordis';
/** One per-step usage row served to the client cost engine. */
export interface StepUsageRow {
  readonly time: number | null;
  readonly model: string | null;
  readonly uncached: number;
  readonly read: number;
  readonly write: number;
  readonly out: number;
}
/** Project stored session events onto per-step usage rows. */
export declare function stepsFromEvents(events: readonly unknown[]): StepUsageRow[];
/** Register the settings namespace and (when composed) the steps endpoint. */
export declare function apply(ctx: Context): void;
