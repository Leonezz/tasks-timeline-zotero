import type { AiBridge, PlanForReview } from "../shared/uiContract";
import { getLibraryAccess } from "../settings/zoteroPrefs";
import type { ZoteroTaskMutations } from "../tasks/taskMutations";
import { createLibraryTools } from "./libraryTools";
import type { HostTool, PreparedPlan } from "./libraryTools";
import { zoteroSystemPrompt } from "./systemPrompt";
import { createWriteTools } from "./writeTools";

/** Zotero tools shared by the sidebar agent and the MCP server. */
export function createHostTools(mutations: ZoteroTaskMutations): HostTool[] {
  return [
    ...createLibraryTools(getLibraryAccess),
    ...createWriteTools(mutations, getLibraryAccess),
  ];
}

const PLAN_TTL_MS = 10 * 60 * 1000;

export function createAiBridge(tools: HostTool[]): AiBridge {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const plans = new Map<string, { plan: PreparedPlan; expires: number }>();

  const toolNamed = (name: string) => {
    const tool = byName.get(name);
    if (!tool) throw new Error(`Unknown Zotero tool "${name}"`);
    return tool;
  };

  return {
    systemPrompt: zoteroSystemPrompt,
    tools: () =>
      tools.map(({ name, description, schema, prepare }) => ({
        name,
        description,
        schema,
        needsConfirmation: Boolean(prepare),
      })),
    executeTool: async (name, args) => {
      const tool = toolNamed(name);
      if (!tool.execute) {
        throw new Error(
          `"${name}" needs the user's confirmation; prepare it first`,
        );
      }
      return tool.execute(args);
    },
    prepareTool: async (name, args): Promise<PlanForReview> => {
      const tool = toolNamed(name);
      if (!tool.prepare) throw new Error(`"${name}" doesn't need confirmation`);
      const plan = await tool.prepare(args);
      const token = Zotero.Utilities.randomString(16);
      plans.set(token, { plan, expires: Date.now() + PLAN_TTL_MS });
      const { title, summary, choices } = plan;
      return { token, title, summary, choices };
    },
    commitTool: async (token, selected) => {
      const entry = plans.get(token);
      plans.delete(token); // single use, even if it fails
      if (!entry || entry.expires < Date.now()) {
        throw new Error(
          "This plan expired or was already used; prepare it again",
        );
      }
      const valid = selected.every(
        (i) => Number.isInteger(i) && i >= 0 && i < entry.plan.choices.length,
      );
      if (!valid) throw new Error("Selection doesn't match the plan's choices");
      return entry.plan.commit([...new Set(selected)].sort((a, b) => a - b));
    },
  };
}
