import { initLocale } from "./utils/locale";
import { createZToolkit } from "./utils/ztoolkit";
import {
  openTimelineTabSafely,
  registerMenus,
  unregisterMenus,
} from "./modules/menu";
import { closeAllTimelineTabs, closeTimelineTab } from "./modules/timelineTab";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();
  registerMenus();

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  // Lets the scaffold test runner confirm the plugin loaded.
  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  addon.data.ztoolkit = createZToolkit();

  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-mainWindow.ftl`,
  );

  if (__env__ === "development") {
    openTimelineTabSafely(win);
  }
}

async function onMainWindowUnload(win: Window): Promise<void> {
  closeTimelineTab(win as _ZoteroTypes.MainWindow);
}

function onShutdown(): void {
  closeAllTimelineTabs();
  unregisterMenus();
  ztoolkit.unregisterAll();
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

// Hooks only dispatch; real work lives in modules.
export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
};
