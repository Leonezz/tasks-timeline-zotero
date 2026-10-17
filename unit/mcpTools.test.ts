import { describe, expect, it, vi } from "vitest";
import type { Task } from "@tasks-timeline/components";
import { createMcpTools } from "../src/mcp/mcpTools";
import type { ZoteroTaskMutations } from "../src/tasks/taskMutations";
import type { ZoteroTaskStore } from "../src/tasks/taskStore";

const existing: Task = {
  id: "1/ABCD1234",
  title: "Water plants",
  status: "todo",
  priority: "medium",
  tags: [],
  dueAt: "2026-10-20",
};

function tools() {
  const store = { getTasks: () => [existing] } as unknown as ZoteroTaskStore;
  const addTask = vi.fn(async (task: Task) => ({ ...task, id: "1/NEWKEY01" }));
  const updateTask = vi.fn(async () => undefined);
  const mutations = {
    addTask,
    updateTask,
    deleteTask: vi.fn(),
  } as unknown as ZoteroTaskMutations;
  const byName = new Map(
    createMcpTools(store, mutations, []).map((tool) => [tool.name, tool]),
  );
  const call = (name: string, args: Record<string, unknown>) => {
    const tool = byName.get(name);
    if (!tool) throw new Error(`no tool ${name}`);
    return tool.call(args) as Promise<Record<string, unknown>>;
  };
  return { call, addTask, updateTask };
}

const START_RULE = "DTSTART:20261016\nRRULE:FREQ=WEEKLY;BYDAY=MO";

describe("MCP task tools store rules as note text", () => {
  it("create_task rejects a rule with a start date before saving", async () => {
    const { call, addTask } = tools();
    const result = await call("create_task", {
      title: "Water plants",
      recurrence: START_RULE,
    });
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/startAt/);
    expect(addTask).not.toHaveBeenCalled();
  });

  it("update_task rejects a rule with a start date before saving", async () => {
    const { call, updateTask } = tools();
    const result = await call("update_task", {
      id: existing.id,
      recurrence: START_RULE,
    });
    expect(result.success).toBe(false);
    expect(updateTask).not.toHaveBeenCalled();
  });

  it("create_task stores RRULE syntax as text", async () => {
    const { call, addTask } = tools();
    await call("create_task", {
      title: "Water plants",
      recurrence: "FREQ=WEEKLY;BYDAY=MO",
    });
    expect(addTask).toHaveBeenCalledWith(
      expect.objectContaining({ recurringInterval: "every week on Monday" }),
    );
  });
});
