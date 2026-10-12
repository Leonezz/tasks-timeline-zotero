import { DEFAULT_SETTINGS } from "@tasks-timeline/components";
import type {
  AppSettings,
  SettingsRepository,
} from "@tasks-timeline/components";
import type { SettingsBridge } from "../shared/uiContract";

/** Copies values across the core/frame realm boundary in both directions. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * Defaults for a first run in Zotero: Gecko has no Web Speech API, so the
 * default "browser" voice provider can't work; voice starts disabled.
 */
export function zoteroFirstRunSettings(): AppSettings {
  const defaults = clone(DEFAULT_SETTINGS);
  return {
    ...defaults,
    voiceConfig: { ...defaults.voiceConfig, enabled: false },
  };
}

export class BridgeSettingsRepository implements SettingsRepository {
  name = "ZoteroSettingsRepository";

  constructor(private readonly bridge: SettingsBridge) {}

  async loadSettings(): Promise<AppSettings | null> {
    const stored = await this.bridge.load();
    return stored ? clone(stored) : zoteroFirstRunSettings();
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    await this.bridge.save(clone(settings));
  }
}
