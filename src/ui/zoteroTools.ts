import type { ToolSpec } from "@tasks-timeline/components";
import type { AiBridge } from "../shared/uiContract";

/** Copies values across the core/frame realm boundary. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * Exposes the core's Zotero library tools to the timeline agent. A tool error
 * rejects here and the agent turns it into an error result for the model.
 */
export function zoteroToolSpecs(ai: AiBridge): ToolSpec[] {
  return clone(ai.tools()).map((descriptor) => ({
    ...descriptor,
    schema: descriptor.schema as ToolSpec["schema"],
    execute: async (args) => ({
      name: descriptor.name,
      result: clone(await ai.executeTool(descriptor.name, clone(args))),
    }),
  }));
}
