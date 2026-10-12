import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { getPref, setPref } from "../utils/prefs";
import { UI_READY_EVENT } from "../shared/uiContract";
import type {
  MountedTimeline,
  MountOptions,
  TimelineUI,
} from "../shared/uiContract";

const SIDEBAR_ID = `${config.addonRef}-sidebar`;
const SPLITTER_ID = `${config.addonRef}-sidebar-splitter`;
const TOOLBAR_BUTTON_ID = `${config.addonRef}-tb-toggle-sidebar`;
const PAGE_URL = `chrome://${config.addonRef}/content/timeline.html`;
const ICON_URL = `chrome://${config.addonRef}/content/icons/timeline.svg`;
const UI_GLOBAL = `__${config.addonRef}_ui__`;
const XHTML_NS = "http://www.w3.org/1999/xhtml";
const MIN_WIDTH = 280;

type MainWindow = _ZoteroTypes.MainWindow;

export type SidebarDeps = Omit<MountOptions, "onError">;

interface SidebarParts {
  deps: SidebarDeps;
  splitter: XULElement;
  sidebar: XULElement;
  button: XULElement;
  mounted?: MountedTimeline;
}

const installed = new Map<MainWindow, SidebarParts>();

/**
 * Adds the timeline sidebar to the right of the item pane in the library tab,
 * plus a toggle button at the end of the items toolbar.
 */
export function installSidebar(win: MainWindow, deps: SidebarDeps): void {
  if (installed.has(win)) return;
  const doc = win.document;
  const trees = requireElement(doc, "zotero-trees");
  const toolbar = requireElement(doc, "zotero-items-toolbar");

  const splitter = doc.createXULElement("splitter") as XULElement;
  splitter.id = SPLITTER_ID;
  for (const [name, value] of Object.entries({
    resizebefore: "closest",
    resizeafter: "closest",
    collapse: "after",
    orient: "horizontal",
  })) {
    splitter.setAttribute(name, value);
  }
  splitter.addEventListener("mouseup", () => persistWidth(win));

  const sidebar = doc.createXULElement("vbox") as XULElement;
  sidebar.id = SIDEBAR_ID;
  // Zotero's pane CSS ignores the XUL width attribute; size via style.
  sidebar.style.width = `${Math.max(getPref("sidebarWidth"), MIN_WIDTH)}px`;
  sidebar.style.minWidth = `${MIN_WIDTH}px`;
  trees.append(splitter, sidebar);

  const button = doc.createXULElement("toolbarbutton") as XULElement;
  button.id = TOOLBAR_BUTTON_ID;
  button.classList.add("zotero-tb-button");
  button.setAttribute("tabindex", "-1");
  button.setAttribute("type", "checkbox");
  button.setAttribute(
    "data-l10n-id",
    `${config.addonRef}-toolbar-toggle-sidebar`,
  );
  button.style.listStyleImage = `url("${ICON_URL}")`;
  button.addEventListener("command", () => toggleSidebar(win));
  toolbar.append(button);

  installed.set(win, { deps, splitter, sidebar, button });
  setSidebarOpen(win, getPref("sidebarOpen"));
}

export function uninstallSidebar(win: MainWindow): void {
  const parts = installed.get(win);
  if (!parts) return;
  installed.delete(win);
  parts.mounted?.unmount();
  parts.splitter.remove();
  parts.sidebar.remove();
  parts.button.remove();
}

export function uninstallAllSidebars(): void {
  for (const win of [...installed.keys()]) {
    uninstallSidebar(win);
  }
}

export function openSidebar(win: MainWindow): void {
  setSidebarOpen(win, true);
}

export function toggleSidebar(win: MainWindow): void {
  const parts = requireInstalled(win);
  setSidebarOpen(win, parts.sidebar.collapsed);
}

function setSidebarOpen(win: MainWindow, open: boolean): void {
  const parts = requireInstalled(win);
  parts.sidebar.collapsed = !open;
  parts.splitter.hidden = !open;
  parts.button.toggleAttribute("checked", open);
  setPref("sidebarOpen", open);
  if (open && !parts.sidebar.firstChild) {
    loadTimeline(win, parts);
  }
}

/** Loaded lazily on first open; kept alive while collapsed to keep UI state. */
function loadTimeline(win: MainWindow, parts: SidebarParts): void {
  const iframe = win.document.createElementNS(
    XHTML_NS,
    "iframe",
  ) as HTMLIFrameElement;
  iframe.style.cssText = "flex: 1; border: 0; width: 100%; min-height: 0;";
  // The frame element never receives "load" for this chrome iframe, so the UI
  // bundle announces itself instead (see src/ui/index.tsx).
  iframe.addEventListener(
    UI_READY_EVENT,
    () => {
      try {
        parts.mounted = mountInFrame(iframe, parts.deps);
        if (__env__ === "development") {
          logDiagnostics(win, parts.mounted);
        }
      } catch (error) {
        reportError(toError(error));
      }
    },
    { once: true },
  );
  iframe.src = PAGE_URL;
  parts.sidebar.append(iframe);
}

function mountInFrame(
  iframe: HTMLIFrameElement,
  deps: SidebarDeps,
): MountedTimeline {
  const frameWin = iframe.contentWindow as
    (Window & { [UI_GLOBAL]?: { default: TimelineUI } }) | null;
  const ui = frameWin?.[UI_GLOBAL]?.default;
  if (!ui || typeof ui.mount !== "function") {
    throw new Error(`${PAGE_URL} did not register ${UI_GLOBAL}`);
  }
  const root = iframe.contentDocument?.getElementById("root");
  if (!root) {
    throw new Error(`${PAGE_URL} has no #root element`);
  }
  return ui.mount(root, { ...deps, onError: reportError });
}

function persistWidth(win: MainWindow): void {
  const parts = installed.get(win);
  if (!parts || parts.sidebar.collapsed) return;
  const width = Math.round(parts.sidebar.getBoundingClientRect().width);
  if (width >= MIN_WIDTH) {
    setPref("sidebarWidth", width);
  }
}

function requireInstalled(win: MainWindow): SidebarParts {
  const parts = installed.get(win);
  if (!parts) {
    throw new Error("Tasks Timeline sidebar is not installed in this window");
  }
  return parts;
}

function requireElement(doc: Document, id: string): Element {
  const el = doc.getElementById(id);
  if (!el) {
    throw new Error(`Zotero layout changed: #${id} not found`);
  }
  return el;
}

export function reportError(error: Error): void {
  Zotero.logError(error);
  Zotero.debug(`[${config.addonRef}] error: ${error.stack || error.message}`);
  new ztoolkit.ProgressWindow(config.addonName, { closeTime: -1 })
    .createLine({
      text: getString("error-timeline", { args: { message: error.message } }),
      type: "fail",
    })
    .show();
}

export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function logDiagnostics(win: MainWindow, mounted: MountedTimeline): void {
  win.setTimeout(() => {
    const report = JSON.stringify(mounted.diagnostics());
    Zotero.debug(`[${config.addonRef}] mount diagnostics: ${report}`);
  }, 2000);
}
