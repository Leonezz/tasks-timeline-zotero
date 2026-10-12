import { assert } from "chai";
import { config } from "../package.json";
import { openTimeline, remountSidebar, waitFor } from "./helpers";

const PREFS = config.prefsPrefix;

describe("first run", function () {
  this.timeout(30000);

  it("starts with voice input off (Gecko has no Web Speech API)", async function () {
    const win = Zotero.getMainWindow() as any;
    const pref = `${PREFS}.appSettings`;
    const saved = Zotero.Prefs.get(pref, true) as string;
    try {
      Zotero.Prefs.set(pref, "", true);
      Zotero.Prefs.set(`${PREFS}.sidebarOpen`, true, true);
      await remountSidebar(win);
      await openTimeline(win);
      const stored = await waitFor(
        () => Zotero.Prefs.get(pref, true) as string,
        "first-run settings to be saved",
      );
      assert.isFalse(JSON.parse(stored).settings.voiceConfig.enabled);
    } finally {
      Zotero.Prefs.set(pref, saved, true);
      await remountSidebar(win);
    }
  });
});
