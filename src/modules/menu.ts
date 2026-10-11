import { config } from "../../package.json";
import { reportError, toError, toggleSidebar } from "./sidebar";

const MENU_ID = `${config.addonRef}-view-toggle-sidebar`;

export function registerMenus(): void {
  const registered = Zotero.MenuManager.registerMenu({
    menuID: MENU_ID,
    pluginID: config.addonID,
    target: "main/menubar/view",
    menus: [
      {
        menuType: "menuitem",
        // Scaffold prefixes Fluent IDs with the addon ref.
        l10nID: `${config.addonRef}-menu-toggle-sidebar`,
        enableForTabTypes: ["library"],
        onCommand: (event) => {
          const win = (event.target as Element).ownerGlobal;
          try {
            toggleSidebar(win as _ZoteroTypes.MainWindow);
          } catch (error) {
            reportError(toError(error));
          }
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
