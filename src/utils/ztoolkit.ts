import {
  BasicTool,
  makeHelperTool,
  ProgressWindowHelper,
  unregister,
} from "zotero-plugin-toolkit";
import { config } from "../../package.json";

export { createZToolkit };

/** Only the toolkit modules this plugin uses, to keep the bundle small. */
class PluginToolkit extends BasicTool {
  ProgressWindow: typeof ProgressWindowHelper;

  constructor() {
    super();
    this.ProgressWindow = makeHelperTool(ProgressWindowHelper, this);
  }

  unregisterAll() {
    unregister(this);
  }
}

function createZToolkit() {
  const toolkit = new PluginToolkit();
  toolkit.basicOptions.log.prefix = `[${config.addonName}]`;
  toolkit.basicOptions.log.disableConsole = __env__ === "production";
  toolkit.basicOptions.api.pluginID = config.addonID;
  toolkit.ProgressWindow.setIconURI(
    "default",
    `chrome://${config.addonRef}/content/icons/favicon.png`,
  );
  return toolkit;
}
