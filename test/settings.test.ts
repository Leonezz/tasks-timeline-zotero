import { assert } from "chai";
import { config } from "../package.json";

const PREFS = config.prefsPrefix;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(
  check: () => T | null | undefined | false,
  what: string,
  timeoutMs = 5000,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = check();
    if (value) return value;
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function storedSecret(name: string): Promise<string | undefined> {
  const logins = await Services.logins.searchLoginsAsync({
    origin: `chrome://${config.addonRef}`,
  });
  return logins.find((l: any) => l.username === name)?.password;
}

describe("settings", function () {
  this.timeout(20000);

  let data: any;
  let savedPref: string;

  before(function () {
    // @ts-expect-error - Plugin instance is not typed
    data = Zotero[config.addonInstance].data;
    savedPref = Zotero.Prefs.get(`${PREFS}.appSettings`, true) as string;
  });

  after(async function () {
    Zotero.Prefs.set(`${PREFS}.appSettings`, savedPref, true);
    Zotero.Prefs.set(`${PREFS}.taskTag`, "#task", true);
    for (const login of await Services.logins.searchLoginsAsync({
      origin: `chrome://${config.addonRef}`,
    })) {
      Services.logins.removeLogin(login);
    }
  });

  function sampleSettings(apiKey: string) {
    return {
      theme: "light",
      aiConfig: {
        enabled: true,
        activeProvider: "anthropic",
        providers: {
          anthropic: { apiKey, baseUrl: "", model: "m" },
          openai: { apiKey: "", baseUrl: "", model: "m" },
        },
      },
      voiceConfig: {
        enabled: false,
        providers: {
          browser: {},
          openai: { apiKey: "", baseUrl: "", model: "w" },
        },
      },
    };
  }

  it("keeps API keys out of prefs and restores them on load", async function () {
    await data.settingsStore.save(sampleSettings("sk-test-123"));

    const raw = Zotero.Prefs.get(`${PREFS}.appSettings`, true) as string;
    assert.notInclude(raw, "sk-test-123");
    assert.equal(JSON.parse(raw).version, 1);
    assert.equal(await storedSecret("ai.anthropic.apiKey"), "sk-test-123");

    const loaded = await data.settingsStore.load();
    assert.equal(loaded.aiConfig.providers.anthropic.apiKey, "sk-test-123");
    assert.equal(loaded.theme, "light");
  });

  it("deletes a key that was cleared", async function () {
    await data.settingsStore.save(sampleSettings("sk-to-delete"));
    await data.settingsStore.save(sampleSettings(""));
    assert.notExists(await storedSecret("ai.anthropic.apiKey"));
  });

  it("applies the last save when saves overlap", async function () {
    const first = data.settingsStore.save({
      ...sampleSettings("a"),
      theme: "dark",
    });
    const second = data.settingsStore.save({
      ...sampleSettings("b"),
      theme: "coffee",
    });
    await Promise.all([first, second]);
    const loaded = await data.settingsStore.load();
    assert.equal(loaded.theme, "coffee");
    assert.equal(loaded.aiConfig.providers.anthropic.apiKey, "b");
  });

  it("never overwrites settings it could not read", async function () {
    const corrupt = '{"version":99,"settings":{}}';
    Zotero.Prefs.set(`${PREFS}.appSettings`, corrupt, true);
    let failed = false;
    await data.settingsStore.load().catch(() => (failed = true));
    assert.isTrue(failed);
    await data.settingsStore.save(sampleSettings("x"));
    assert.equal(Zotero.Prefs.get(`${PREFS}.appSettings`, true), corrupt);

    // A later successful load re-enables saving.
    Zotero.Prefs.set(`${PREFS}.appSettings`, "", true);
    assert.isNull(await data.settingsStore.load());
    await data.settingsStore.save(sampleSettings("y"));
    assert.notEqual(Zotero.Prefs.get(`${PREFS}.appSettings`, true), "");
  });

  it("reloads tasks when the task tag changes", async function () {
    const note = new Zotero.Item("note");
    note.libraryID = Zotero.Libraries.userLibraryID;
    note.setNote("<p>Tagged todo</p>");
    note.addTag("#todo");
    await note.saveTx({ skipSelect: true } as any);
    try {
      const has = () =>
        data.taskStore.getTasks().some((t: any) => t.title === "Tagged todo");
      assert.isFalse(has());
      Zotero.Prefs.set(`${PREFS}.taskTag`, "#todo", true);
      await waitFor(has, "task with the new tag");
      Zotero.Prefs.set(`${PREFS}.taskTag`, "#task", true);
      await waitFor(() => !has(), "task to disappear after restoring the tag");
    } finally {
      await note.eraseTx();
    }
  });
});
