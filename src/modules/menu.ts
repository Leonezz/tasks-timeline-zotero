import { config } from "../../package.json";
import { openSidebar, reportError, toError, toggleSidebar } from "./sidebar";
import type { ZoteroTaskMutations } from "../tasks/taskMutations";

const VIEW_MENU_ID = `${config.addonRef}-view-toggle-sidebar`;
const ITEM_MENU_ID = `${config.addonRef}-item-add-task`;

type MainWindow = _ZoteroTypes.MainWindow;

function windowOf(event: Event): MainWindow {
  return (event.target as Element).ownerGlobal as MainWindow;
}

function register(
  options: Parameters<typeof Zotero.MenuManager.registerMenu>[0],
) {
  if (!Zotero.MenuManager.registerMenu(options)) {
    throw new Error(`Zotero.MenuManager rejected menu ${options.menuID}`);
  }
}

export function registerMenus(mutations: ZoteroTaskMutations): void {
  register({
    menuID: VIEW_MENU_ID,
    pluginID: config.addonID,
    target: "main/menubar/view",
    menus: [
      {
        menuType: "menuitem",
        // Scaffold prefixes Fluent IDs with the addon ref.
        l10nID: `${config.addonRef}-menu-toggle-sidebar`,
        enableForTabTypes: ["library"],
        onCommand: (event) => {
          try {
            toggleSidebar(windowOf(event));
          } catch (error) {
            reportError(toError(error));
          }
        },
      },
    ],
  });

  register({
    menuID: ITEM_MENU_ID,
    pluginID: config.addonID,
    target: "main/library/item",
    menus: [
      {
        menuType: "menuitem",
        l10nID: `${config.addonRef}-menu-add-task-for-item`,
        onShowing: (_event, context) => {
          const items = context.items ?? [];
          context.setVisible(items.length === 1 && items[0].isRegularItem());
          context.setEnabled(items.length === 1 && items[0].library.editable);
        },
        onCommand: (event, context) => {
          const item = context.items?.[0];
          if (!item) return;
          const win = windowOf(event);
          mutations
            .addTaskForItem(item)
            .then(async (note) => {
              openSidebar(win);
              // Selecting the note opens its editor so the title can be edited.
              await win.ZoteroPane.selectItem(note.id);
            })
            .catch((error) => reportError(toError(error)));
        },
      },
    ],
  });
}

export function unregisterMenus(): void {
  Zotero.MenuManager.unregisterMenu(VIEW_MENU_ID);
  Zotero.MenuManager.unregisterMenu(ITEM_MENU_ID);
}
