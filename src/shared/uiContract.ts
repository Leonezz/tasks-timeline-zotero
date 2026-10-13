/**
 * Contract between the plugin core (bootstrap sandbox) and the UI bundle,
 * which runs inside the sidebar iframe (content/timeline.html). Both bundles
 * import these types; only the UI bundle provides the implementation.
 */

import type { AppSettings, Task } from "@tasks-timeline/components";
import type { HostToolDescriptor, LibraryAccess } from "../ai/libraryTools";
import type { McpStatus } from "../mcp/mcpServer";
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
  /** Resolves with the stored task (its id is the note's "libraryID/KEY"). */
  addTask: (task: Task) => Promise<Task>;
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
  getLibraryAccess: () => LibraryAccess;
  setLibraryAccess: (access: Partial<LibraryAccess>) => void;
  getMcpStatus: () => McpStatus;
  setMcpEnabled: (enabled: boolean) => Promise<McpStatus>;
  regenerateMcpToken: () => Promise<McpStatus>;
  copyToClipboard: (text: string) => void;
}

export interface AiBridge {
  /** Zotero-specific context for the agent's system prompt. */
  systemPrompt: () => string;
  /** Library tools the agent can call (in addition to the task tools). */
  tools: () => HostToolDescriptor[];
  /** Runs a library tool in the core; rejects with a message on failure. */
  executeTool: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
  /** For tools with needsConfirmation: builds a plan without writing. */
  prepareTool: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<PlanForReview>;
  /** Applies a prepared plan once; `selected` are indices into its choices. */
  commitTool: (token: string, selected: number[]) => Promise<unknown>;
}

export interface PlanForReview {
  token: string;
  title: string;
  summary: Record<string, unknown>;
  choices: { label: string; detail?: string }[];
}

export interface MountOptions {
  taskSource: TaskSource;
  taskActions: TaskActions;
  settings: SettingsBridge;
  zoteroPrefs: ZoteroPrefsBridge;
  ai: AiBridge;
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
