/**
 * Contract between the plugin core (bootstrap sandbox) and the UI bundle
 * (loaded into a main window). Both bundles import these types; only the UI
 * bundle provides the implementation.
 */

export interface MountOptions {
  /** Reports a fatal UI error to the core so it can surface it in Zotero. */
  onError: (error: Error) => void;
}

export interface MountDiagnostics {
  hasShadowRoot: boolean;
  styleTextLength: number;
  appRootRendered: boolean;
}

export interface MountedTimeline {
  unmount: () => void;
  diagnostics: () => MountDiagnostics;
}

export interface TimelineUI {
  mount: (host: HTMLElement, options: MountOptions) => MountedTimeline;
}
