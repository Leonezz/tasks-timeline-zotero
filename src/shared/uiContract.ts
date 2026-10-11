/**
 * Contract between the plugin core (bootstrap sandbox) and the UI bundle,
 * which runs inside the sidebar iframe (content/timeline.html). Both bundles
 * import these types; only the UI bundle provides the implementation.
 */

import { config } from "../../package.json";

/** Dispatched by the UI bundle on its frame element once it can be mounted. */
export const UI_READY_EVENT = `${config.addonRef}-ui-ready`;

export interface MountOptions {
  /** Reports a fatal UI error to the core so it can surface it in Zotero. */
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
