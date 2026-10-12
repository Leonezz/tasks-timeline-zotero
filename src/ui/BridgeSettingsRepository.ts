import type {
  AppSettings,
  SettingsRepository,
} from "@tasks-timeline/components";
import type { SettingsBridge } from "../shared/uiContract";

/** Copies values across the core/frame realm boundary in both directions. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export class BridgeSettingsRepository implements SettingsRepository {
  name = "ZoteroSettingsRepository";

  constructor(private readonly bridge: SettingsBridge) {}

  async loadSettings(): Promise<AppSettings | null> {
    const stored = await this.bridge.load();
    return stored ? clone(stored) : null;
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    await this.bridge.save(clone(settings));
  }
}
