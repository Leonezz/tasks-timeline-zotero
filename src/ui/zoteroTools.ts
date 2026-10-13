import type { ToolSpec } from "@tasks-timeline/components";
import type { AiBridge, PlanForReview } from "../shared/uiContract";

/** Copies values across the core/frame realm boundary. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Shows a plan to the user; resolves with chosen indices, or null if declined. */
export type ReviewPlan = (plan: PlanForReview) => Promise<number[] | null>;

/**
 * Exposes the core's Zotero tools to the timeline agent. A tool error rejects
 * here and the agent turns it into an error result for the model. Tools that
 * need confirmation always go through `reviewPlan` before anything is written.
 */
export function zoteroToolSpecs(
  ai: AiBridge,
  reviewPlan: ReviewPlan,
): ToolSpec[] {
  return clone(ai.tools()).map(({ needsConfirmation, ...descriptor }) => ({
    ...descriptor,
    schema: descriptor.schema as ToolSpec["schema"],
    execute: async (args) => {
      if (!needsConfirmation) {
        return {
          name: descriptor.name,
          result: clone(await ai.executeTool(descriptor.name, clone(args))),
        };
      }
      const plan = clone(await ai.prepareTool(descriptor.name, clone(args)));
      if (plan.choices.length === 0) {
        return {
          name: descriptor.name,
          result: { created: 0, message: "Nothing to create", ...plan.summary },
        };
      }
      const selected = await reviewPlan(plan);
      if (!selected) {
        return {
          name: descriptor.name,
          result: { created: 0, message: "Cancelled by user" },
        };
      }
      return {
        name: descriptor.name,
        result: clone(await ai.commitTool(plan.token, selected)),
      };
    },
  }));
}
