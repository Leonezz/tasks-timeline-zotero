import { config } from "../../package.json";
import { getString } from "../utils/locale";
import type { MountedTimeline, TimelineUI } from "../shared/uiContract";

// Zotero_Tabs.parseTabType() splits on "-", so the type must not contain one.
const TAB_TYPE = config.addonRef;
const UI_GLOBAL = `__${config.addonRef}_ui__`;
const UI_SCRIPT = `${rootURI}content/scripts/${config.addonRef}-ui.js`;
const XHTML_NS = "http://www.w3.org/1999/xhtml";

interface OpenTab {
  tabID: string;
  mounted: MountedTimeline;
}

type UIWindow = _ZoteroTypes.MainWindow & {
  [UI_GLOBAL]?: { default: TimelineUI };
};

const openTabs = new Map<_ZoteroTypes.MainWindow, OpenTab>();

export function openTimelineTab(win: _ZoteroTypes.MainWindow): void {
  const existing = openTabs.get(win);
  if (existing) {
    win.Zotero_Tabs.select(existing.tabID);
    return;
  }

  const ui = loadUI(win);
  const { id: tabID, container } = win.Zotero_Tabs.add({
    type: TAB_TYPE,
    title: getString("tab-title"),
    data: {},
    select: true,
    onClose: () => disposeTab(win),
  });

  const host = win.document.createElementNS(XHTML_NS, "div") as HTMLDivElement;
  host.id = `${config.addonRef}-host`;
  host.style.cssText = "flex: 1; width: 100%; height: 100%; min-height: 0;";
  container.appendChild(host);

  const mounted = ui.mount(host, {
    onError: (error) => reportError(error),
  });
  openTabs.set(win, { tabID, mounted });

  if (__env__ === "development") {
    logDiagnosticsAfterRender(win, mounted);
  }
}

export function closeTimelineTab(win: _ZoteroTypes.MainWindow): void {
  const tab = openTabs.get(win);
  if (tab) {
    // Triggers onClose -> disposeTab. skipHistory keeps "reopen closed tab"
    // from restoring an empty shell; zotero-types omits this parameter.
    const closeTab = win.Zotero_Tabs.close.bind(win.Zotero_Tabs) as (
      ids: string,
      options: { skipHistory: boolean },
    ) => void;
    closeTab(tab.tabID, { skipHistory: true });
  }
  delete (win as UIWindow)[UI_GLOBAL];
}

export function closeAllTimelineTabs(): void {
  for (const win of [...openTabs.keys()]) {
    closeTimelineTab(win);
  }
}

function disposeTab(win: _ZoteroTypes.MainWindow): void {
  const tab = openTabs.get(win);
  if (!tab) return;
  openTabs.delete(win);
  tab.mounted.unmount();
}

/**
 * Loads the React bundle into the window's own global scope, where React finds
 * the real DOM globals. Re-reads the script each time so dev reloads pick up
 * new builds.
 */
function loadUI(win: _ZoteroTypes.MainWindow): TimelineUI {
  const uiWin = win as UIWindow;
  if (!uiWin[UI_GLOBAL]) {
    Services.scriptloader.loadSubScriptWithOptions(UI_SCRIPT, {
      target: win,
      ignoreCache: true,
    });
  }
  const ui = uiWin[UI_GLOBAL]?.default;
  if (!ui || typeof ui.mount !== "function") {
    throw new Error(`UI bundle did not register ${UI_GLOBAL} (${UI_SCRIPT})`);
  }
  return ui;
}

export function reportError(error: Error): void {
  Zotero.logError(error);
  new ztoolkit.ProgressWindow(config.addonName, { closeTime: -1 })
    .createLine({
      text: getString("error-open-tab", { args: { message: error.message } }),
      type: "fail",
    })
    .show();
}

function logDiagnosticsAfterRender(
  win: _ZoteroTypes.MainWindow,
  mounted: MountedTimeline,
): void {
  win.setTimeout(() => {
    const report = JSON.stringify(mounted.diagnostics());
    Zotero.debug(`[${config.addonRef}] mount diagnostics: ${report}`);
  }, 2000);
}
