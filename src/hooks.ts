import { config, version } from "../package.json";
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
import { ZoteroTaskStore } from "./tasks/taskStore";
import type { TaskLoadFailure } from "./tasks/taskStore";
import { ZoteroTaskMutations } from "./tasks/taskMutations";
import { SecretStore } from "./settings/secretStore";
import { ZoteroSettingsStore } from "./settings/settingsStore";
import {
  createZoteroPrefsBridge,
  getTaskTag,
  syncMcpServer,
} from "./settings/zoteroPrefs";
import { createAiBridge, createHostTools } from "./ai/aiBridge";
import { zoteroSystemPrompt } from "./ai/systemPrompt";
import { McpServer } from "./mcp/mcpServer";
import { createMcpTools } from "./mcp/mcpTools";

const ADDON_FTL = `${config.addonRef}-addon.ftl`;

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  try {
    initLocale();
    // Undo labels are Fluent IDs resolved through Zotero's localization.
    Zotero.ftl.addResourceIds([ADDON_FTL]);
    const secrets = new SecretStore();
    addon.data.settingsStore = new ZoteroSettingsStore(secrets, (error) =>
      reportError(
        new Error(
          getString("error-settings-load", {
            args: { message: error.message },
          }),
        ),
      ),
    );
    addon.data.taskStore = new ZoteroTaskStore(getTaskTag, reportLoadFailures);
    addon.data.taskMutations = new ZoteroTaskMutations(
      addon.data.taskStore,
      getTaskTag,
    );
    const hostTools = createHostTools(addon.data.taskMutations);
    addon.data.aiBridge = createAiBridge(hostTools);
    const mcpTools = createMcpTools(
      addon.data.taskStore,
      addon.data.taskMutations,
      hostTools,
    );
    const mcpServer = new McpServer(secrets, {
      name: "zotero-tasks-timeline",
      version,
      instructions: `${zoteroSystemPrompt()}\nDeleting tasks and other actions that need confirmation aren't available here; ask the user to do them in Zotero.`,
      tools: () => mcpTools,
    });
    addon.data.mcpServer = mcpServer;
    await syncMcpServer(mcpServer);
    addon.data.mcpObserver = Zotero.Prefs.registerObserver(
      `${config.prefsPrefix}.mcpEnabled`,
      () => {
        syncMcpServer(mcpServer).catch((e) => reportError(toError(e)));
      },
      true,
    );
    await addon.data.taskStore.start();
    addon.data.taskTagObserver = Zotero.Prefs.registerObserver(
      `${config.prefsPrefix}.taskTag`,
      () => {
        addon.data.taskStore?.reload().catch((e) => reportError(toError(e)));
      },
      true,
    );
    registerMenus(addon.data.taskMutations);
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
    const { taskStore, taskMutations, settingsStore, aiBridge, mcpServer } =
      addon.data;
    if (
      !taskStore ||
      !taskMutations ||
      !settingsStore ||
      !aiBridge ||
      !mcpServer
    ) {
      throw new Error("Tasks Timeline services are not initialized");
    }
    installSidebar(win, {
      taskSource: taskStore,
      taskActions: taskMutations,
      settings: {
        load: () => settingsStore.load(),
        save: (settings) => settingsStore.save(settings),
      },
      zoteroPrefs: createZoteroPrefsBridge(mcpServer),
      ai: aiBridge,
    });
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
  addon.data.mcpServer?.stop();
  if (addon.data.mcpObserver) {
    Zotero.Prefs.unregisterObserver(addon.data.mcpObserver);
  }
  if (addon.data.taskTagObserver) {
    Zotero.Prefs.unregisterObserver(addon.data.taskTagObserver);
  }
  Zotero.ftl.removeResourceIds([ADDON_FTL]);
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
