import type {
  AppSettings,
  SettingsRepository,
} from "@tasks-timeline/components";

/**
 * M0 only: keeps settings for the lifetime of the tab, so the component
 * library never falls back to window.localStorage (unavailable to chrome
 * documents). Persistent settings via Zotero.Prefs land in M3.
 */
export class SessionSettingsRepository implements SettingsRepository {
  name = "SessionSettingsRepository";
  private settings: AppSettings | null = null;

  async loadSettings(): Promise<AppSettings | null> {
    return this.settings;
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    this.settings = settings;
  }
}
