import { describe, expect, it, vi } from "vitest";
import type { SettingsRepository, Task } from "@tasks-timeline/components";
import { timelineAppProps } from "../src/ui/timelineAppProps";
import type { AiBridge, TaskActions } from "../src/shared/uiContract";

const task: Task = {
  id: "1/ABCD1234",
  title: "Water plants",
  status: "todo",
  priority: "medium",
  tags: [],
};

function props(taskActions: Partial<TaskActions> = {}) {
  const onError = vi.fn();
  const built = timelineAppProps({
    tasks: [task],
    settingsRepository: {} as SettingsRepository,
    customSettingsTabs: [],
    ai: { systemPrompt: () => "prompt" } as unknown as AiBridge,
    aiExtraTools: [],
    systemInDarkMode: false,
    taskActions: taskActions as TaskActions,
    onError,
  });
  return { built, onError };
}

describe("the props TimelineRoot gives TasksTimelineApp", () => {
  it("saves recurrence rules as Obsidian Tasks text", () => {
    // Notes can't hold RRULE syntax or a rule's start date
    expect(props().built.recurrenceFormat).toBe("text");
  });

  it("marks browser speech recognition unavailable", () => {
    // Gecko has no speech service, so the Browser voice provider can't work
    expect(props().built.voiceRuntime).toEqual({
      browserSpeechSupported: false,
    });
  });

  it("passes the tasks and the agent's system prompt", () => {
    const { built } = props();
    expect(built.tasks).toEqual([task]);
    expect(built.aiSystemPrompt).toBe("prompt");
  });

  it("shows a failed write in Zotero and still fails it", async () => {
    const failure = new Error("note is read-only");
    const { built, onError } = props({
      updateTask: vi.fn(async () => {
        throw failure;
      }),
    });
    await expect(built.onTaskUpdated(task, task)).rejects.toBe(failure);
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it("returns the stored task from an add, copied into this realm", async () => {
    const stored = { ...task, id: "1/NEWKEY01" };
    const { built } = props({ addTask: vi.fn(async () => stored) });
    const result = await built.onTaskAdded(task);
    expect(result).toEqual(stored);
    expect(result).not.toBe(stored);
  });
});
