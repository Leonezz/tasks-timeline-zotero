/**
 * Contract between the plugin core (bootstrap sandbox) and the UI bundle,
 * which runs inside the sidebar iframe (content/timeline.html). Both bundles
 * import these types; only the UI bundle provides the implementation.
 */

import type { AppSettings, Task } from "@tasks-timeline/components";
import { config } from "../../package.json";

/** Dispatched by the UI bundle on its frame element once it can be mounted. */
export const UI_READY_EVENT = `${config.addonRef}-ui-ready`;

/** Live, read-only view of the tasks stored in Zotero notes. */
export interface TaskSource {
  /** Returns the same array until the tasks change (useSyncExternalStore). */
  getTasks: () => readonly Task[];
  subscribe: (listener: () => void) => () => void;
}

/** Writes from the timeline back to Zotero. Rejections are shown to the user. */
export interface TaskActions {
  addTask: (task: Task) => Promise<void>;
  updateTask: (task: Task, previous: Task) => Promise<void>;
  deleteTask: (taskId: string, previous: Task) => Promise<void>;
  /** Shows the task's note in the library. */
  revealTask: (task: Task) => Promise<void>;
}

/** Timeline settings persisted by the core (API keys in the login manager). */
export interface SettingsBridge {
  load: () => Promise<AppSettings | null>;
  save: (settings: AppSettings) => Promise<void>;
}

/** Plugin-level preferences shown in the timeline's "Zotero" settings tab. */
export interface ZoteroPrefsBridge {
  getTaskTag: () => string;
  /** Throws when the tag is invalid. */
  setTaskTag: (tag: string) => void;
}

export interface MountOptions {
  taskSource: TaskSource;
  taskActions: TaskActions;
  settings: SettingsBridge;
  zoteroPrefs: ZoteroPrefsBridge;
  /** Reports a UI error to the core so it can surface it in Zotero. */
  onError: (error: Error) => void;
}

export interface MountDiagnostics {
  hasBody: boolean;
  styleTextLength: number;
  appRootRendered: boolean;
}

export interface MountedTimeline {
  unmount: () => void;
  diagnostics: () => MountDiagnostics;
}

export interface TimelineUI {
  mount: (root: HTMLElement, options: MountOptions) => MountedTimeline;
}
