import { assert } from "chai";
import { config } from "../package.json";

describe("startup", function () {
  it("registers the plugin instance", function () {
    // @ts-expect-error - Plugin instance is not typed
    assert.isTrue(Zotero[config.addonInstance].data.initialized);
  });
});
