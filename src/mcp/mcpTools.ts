/**
 * The tools Tasks Timeline offers to external agents over MCP. There is no
 * one in Zotero to confirm destructive actions for an MCP client, so those
 * tools are left out rather than offered and refused.
 */
import { createCapabilities } from "@tasks-timeline/components/capabilities";
import type {
  CapabilityContext,
  ToolSpec,
} from "@tasks-timeline/components/capabilities";
import type { Task } from "@tasks-timeline/components";
import type { HostTool } from "../ai/libraryTools";
import type { ZoteroTaskMutations } from "../tasks/taskMutations";
import type { ZoteroTaskStore } from "../tasks/taskStore";
import type { McpTool } from "./protocol";

/** Timeline task tools that don't need confirmation. */
export const MCP_TASK_TOOLS = [
  "query_tasks",
  "get_task_stats",
  "get_today_plan",
  "create_task",
  "update_task",
  "complete_task",
  "cancel_task",
];

function capabilityContext(
  store: ZoteroTaskStore,
  mutations: ZoteroTaskMutations,
): CapabilityContext {
  const find = (id: string): Task => {
    const task = store.getTasks().find((t) => t.id === id);
    if (!task) throw new Error(`Task not found: ${id}`);
    return task;
  };
  return {
    getTasks: async () => [...store.getTasks()],
    getTask: async (id) => store.getTasks().find((t) => t.id === id) ?? null,
    addTask: (task) => mutations.addTask(task),
    // (returns the stored task so create_task reports its real id)
    updateTask: (task) => mutations.updateTask(task, find(task.id)),
    deleteTask: (id) => mutations.deleteTask(id),
    // No user to ask: anything needing confirmation is refused.
    confirmPolicy: "require",
    // Task notes hold rules as Obsidian Tasks text: RRULE syntax is stored as
    // text, and rules a note can't hold (DTSTART) are refused before saving.
    recurrenceFormat: "text",
  };
}

function fromToolSpec(spec: ToolSpec): McpTool {
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: spec.schema,
    call: async (args) => (await spec.execute(args)).result,
  };
}

function fromHostTool(
  tool: HostTool & { execute: NonNullable<HostTool["execute"]> },
): McpTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.schema,
    call: (args) => tool.execute(args),
  };
}

export function createMcpTools(
  store: ZoteroTaskStore,
  mutations: ZoteroTaskMutations,
  hostTools: HostTool[],
): McpTool[] {
  const capabilities = createCapabilities(capabilityContext(store, mutations));
  return [
    ...capabilities.tools
      .filter((tool) => MCP_TASK_TOOLS.includes(tool.name))
      .map(fromToolSpec),
    // Tools that need the user's review in the sidebar aren't offered.
    ...hostTools
      .filter(
        (
          tool,
        ): tool is HostTool & { execute: NonNullable<HostTool["execute"]> } =>
          typeof tool.execute === "function",
      )
      .map(fromHostTool),
  ];
}
