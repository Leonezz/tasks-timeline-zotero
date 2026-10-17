/**
 * The props the Zotero sidebar gives TasksTimelineApp, built without React
 * so unit tests can check the host options a refactor must not drop.
 */
import type {
  CustomSettingsTab,
  SettingsRepository,
  Task,
  TasksTimelineAppProps,
  VoiceRuntime,
} from "@tasks-timeline/components";
import type { ToolSpec } from "@tasks-timeline/components/capabilities";
import type { AiBridge, TaskActions } from "../shared/uiContract";

// Gecko has no speech service, so the Browser voice provider can't work.
const NO_BROWSER_SPEECH: VoiceRuntime = { browserSpeechSupported: false };

export interface TimelineAppInputs {
  tasks: Task[];
  settingsRepository: SettingsRepository;
  customSettingsTabs: CustomSettingsTab[];
  ai: AiBridge;
  aiExtraTools: ToolSpec[];
  systemInDarkMode: boolean;
  taskActions: TaskActions;
  onError: (error: Error) => void;
}

/** Tasks come from the core's realm; copy them into this frame's realm. */
const intoThisRealm = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export function timelineAppProps(
  inputs: TimelineAppInputs,
): TasksTimelineAppProps {
  const { taskActions, onError } = inputs;
  // Show the failure in Zotero, then rethrow: the timeline (and its AI
  // agent) must not treat a failed write as success.
  const report = <T>(promise: Promise<T>): Promise<T> =>
    promise.catch((error: unknown) => {
      const failure = error instanceof Error ? error : new Error(String(error));
      onError(failure);
      throw failure;
    });

  return {
    tasks: inputs.tasks,
    settingsRepository: inputs.settingsRepository,
    customSettingsTabs: inputs.customSettingsTabs,
    aiSystemPrompt: inputs.ai.systemPrompt(),
    aiExtraTools: inputs.aiExtraTools,
    // Notes hold rules as Obsidian Tasks text; the editor and the agent
    // must not save RRULE syntax or start dates a note can't hold.
    recurrenceFormat: "text",
    voiceRuntime: NO_BROWSER_SPEECH,
    systemInDarkMode: inputs.systemInDarkMode,
    onTaskAdded: (task) =>
      report(taskActions.addTask(task)).then((stored) => intoThisRealm(stored)),
    onTaskUpdated: (task, previous) =>
      report(taskActions.updateTask(task, previous)),
    onTaskDeleted: (taskId, previous) =>
      report(taskActions.deleteTask(taskId, previous)),
    onItemClick: (task) => {
      // Not awaited by the timeline; the error was already shown.
      report(taskActions.revealTask(task)).catch(() => undefined);
    },
  };
}
