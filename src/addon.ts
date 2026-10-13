import { config } from "../package.json";
import hooks from "./hooks";
import { createZToolkit } from "./utils/ztoolkit";
import type { ZoteroTaskStore } from "./tasks/taskStore";
import type { ZoteroTaskMutations } from "./tasks/taskMutations";
import type { ZoteroSettingsStore } from "./settings/settingsStore";
import type { AiBridge } from "./shared/uiContract";

class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    env: "development" | "production";
    initialized?: boolean;
    ztoolkit: ZToolkit;
    locale?: {
      current: any;
    };
    taskStore?: ZoteroTaskStore;
    taskMutations?: ZoteroTaskMutations;
    settingsStore?: ZoteroSettingsStore;
    taskTagObserver?: symbol;
    aiBridge?: AiBridge;
  };
  public hooks: typeof hooks;
  public api: object;

  constructor() {
    this.data = {
      alive: true,
      config,
      env: __env__,
      initialized: false,
      ztoolkit: createZToolkit(),
    };
    this.hooks = hooks;
    this.api = {};
  }
}

export default Addon;
