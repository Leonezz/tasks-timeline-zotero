import { getString, initLocale } from "./utils/locale";
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
import { DEFAULT_TASK_TAG } from "./tasks/noteFormat";
import { ZoteroTaskStore } from "./tasks/taskStore";
import type { TaskLoadFailure } from "./tasks/taskStore";
import { createReadOnlyTaskActions } from "./tasks/taskActions";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  try {
    initLocale();
    addon.data.taskActions = createReadOnlyTaskActions();
    addon.data.taskStore = new ZoteroTaskStore(
      DEFAULT_TASK_TAG,
      reportLoadFailures,
    );
    await addon.data.taskStore.start();
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
    const { taskStore, taskActions } = addon.data;
    if (!taskStore || !taskActions) {
      throw new Error("Task store is not initialized");
    }
    installSidebar(win, { taskSource: taskStore, taskActions });
  } catch (error) {
    reportError(toError(error));
  }
}

async function onMainWindowUnload(win: Window): Promise<void> {
  uninstallSidebar(win as _ZoteroTypes.MainWindow);
}

function reportLoadFailures(failures: TaskLoadFailure[]): void {
  for (const { noteID, error } of failures) {
    Zotero.logError(error);
    Zotero.debug(
      `[${addon.data.config.addonRef}] note ${noteID}: ${error.message}`,
    );
  }
  reportError(
    new Error(
      getString("error-load-notes", { args: { count: failures.length } }),
    ),
  );
}

function onShutdown(): void {
  uninstallAllSidebars();
  addon.data.taskStore?.stop();
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
