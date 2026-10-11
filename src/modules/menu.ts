import { config } from "../../package.json";
import { openTimelineTab, reportError } from "./timelineTab";

const MENU_ID = `${config.addonRef}-view-open-timeline`;

export function registerMenus(): void {
  const registered = Zotero.MenuManager.registerMenu({
    menuID: MENU_ID,
    pluginID: config.addonID,
    target: "main/menubar/view",
    menus: [
      {
        menuType: "menuitem",
        // Scaffold prefixes Fluent IDs with the addon ref.
        l10nID: `${config.addonRef}-menu-open-timeline`,
        onCommand: (event) => {
          const win = (event.target as Element).ownerGlobal;
          openTimelineTabSafely(win as _ZoteroTypes.MainWindow);
        },
      },
    ],
  });
  if (!registered) {
    throw new Error(`Zotero.MenuManager rejected menu ${MENU_ID}`);
  }
}

export function unregisterMenus(): void {
  Zotero.MenuManager.unregisterMenu(MENU_ID);
}

export function openTimelineTabSafely(win: _ZoteroTypes.MainWindow): void {
  try {
    openTimelineTab(win);
  } catch (error) {
    reportError(error instanceof Error ? error : new Error(String(error)));
  }
}
