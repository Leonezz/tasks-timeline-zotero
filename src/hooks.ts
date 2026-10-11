import { initLocale } from "./utils/locale";
import { setPref } from "./utils/prefs";
import { createZToolkit } from "./utils/ztoolkit";
import { registerMenus, unregisterMenus } from "./modules/menu";
import {
  installSidebar,
  reportError,
  toError,
  uninstallAllSidebars,
  uninstallSidebar,
} from "./modules/sidebar";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  try {
    initLocale();
    registerMenus();
    if (__env__ === "development") {
      setPref("sidebarOpen", true);
    }

    await Promise.all(
      Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
    );
  } catch (error) {
    // Bootstrap swallows startup rejections; make them visible.
    reportError(toError(error));
    throw error;
  }

  // Lets the scaffold test runner confirm the plugin loaded.
  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  addon.data.ztoolkit = createZToolkit();

  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-mainWindow.ftl`,
  );

  try {
    installSidebar(win);
  } catch (error) {
    reportError(toError(error));
  }
}

async function onMainWindowUnload(win: Window): Promise<void> {
  uninstallSidebar(win as _ZoteroTypes.MainWindow);
}

function onShutdown(): void {
  uninstallAllSidebars();
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
