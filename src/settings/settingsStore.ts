import type { AppSettings } from "@tasks-timeline/components";
import { getPref, setPref } from "../utils/prefs";
import type { SecretStore } from "./secretStore";

const SCHEMA_VERSION = 1;

interface StoredSettings {
  version: number;
  settings: AppSettings;
}

type ProviderMap = Record<string, { apiKey?: string } | undefined>;

/** Every provider config that carries an apiKey, with a stable secret name. */
function secretSlots(settings: AppSettings) {
  const slots: { name: string; holder: { apiKey?: string } }[] = [];
  const add = (scope: string, providers: ProviderMap | undefined) => {
    for (const [provider, holder] of Object.entries(providers ?? {})) {
      if (holder && "apiKey" in holder) {
        slots.push({ name: `${scope}.${provider}.apiKey`, holder });
      }
    }
  };
  add("ai", settings.aiConfig?.providers as ProviderMap | undefined);
  add("voice", settings.voiceConfig?.providers as ProviderMap | undefined);
  return slots;
}

/**
 * Persists the timeline's AppSettings as JSON in a Zotero pref, with API keys
 * split out into the SecretStore.
 */
export class ZoteroSettingsStore {
  /** Last value written per secret, so unchanged keys aren't rewritten. */
  private readonly written = new Map<string, string>();
  /** Saves run in order so an older snapshot never lands last. */
  private saving: Promise<void> = Promise.resolve();
  /**
   * Set when stored settings couldn't be read. Saving would replace them with
   * defaults, so writes are refused for the rest of the session.
   */
  private loadError: Error | null = null;

  constructor(
    private readonly secrets: SecretStore,
    private readonly onLoadError: (error: Error) => void,
  ) {}

  async load(): Promise<AppSettings | null> {
    try {
      const settings = await this.read();
      this.loadError = null;
      return settings;
    } catch (error) {
      this.loadError =
        error instanceof Error ? error : new Error(String(error));
      this.onLoadError(this.loadError);
      throw this.loadError;
    }
  }

  private async read(): Promise<AppSettings | null> {
    const raw = getPref("appSettings");
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredSettings;
    if (stored.version !== SCHEMA_VERSION) {
      throw new Error(
        `Unsupported Tasks Timeline settings version ${stored.version}`,
      );
    }
    const settings = stored.settings;
    for (const { name, holder } of secretSlots(settings)) {
      const value = await this.secrets.get(name);
      holder.apiKey = value;
      this.written.set(name, value);
    }
    return settings;
  }

  save(settings: AppSettings): Promise<void> {
    if (this.loadError) {
      // Already reported when loading failed; keep the stored data intact.
      return Promise.resolve();
    }
    const copy = JSON.parse(JSON.stringify(settings)) as AppSettings;
    const run = this.saving.catch(() => undefined).then(() => this.write(copy));
    this.saving = run;
    return run;
  }

  private async write(copy: AppSettings): Promise<void> {
    for (const { name, holder } of secretSlots(copy)) {
      const value = holder.apiKey ?? "";
      if (this.written.get(name) !== value) {
        await this.secrets.set(name, value);
        this.written.set(name, value);
      }
      holder.apiKey = "";
    }
    const stored: StoredSettings = { version: SCHEMA_VERSION, settings: copy };
    setPref("appSettings", JSON.stringify(stored));
  }
}
