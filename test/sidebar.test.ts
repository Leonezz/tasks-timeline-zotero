import { assert } from "chai";
import { config } from "../package.json";

const SIDEBAR_ID = `${config.addonRef}-sidebar`;
const BUTTON_ID = `${config.addonRef}-tb-toggle-sidebar`;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(
  check: () => T | null | undefined | false,
  what: string,
  timeoutMs = 10000,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = check();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

function press(frameWin: any, el: Element) {
  const opts = { bubbles: true, cancelable: true, composed: true, button: 0 };
  el.dispatchEvent(
    new frameWin.PointerEvent("pointerdown", { ...opts, pointerType: "mouse" }),
  );
  el.dispatchEvent(new frameWin.MouseEvent("mousedown", opts));
  el.dispatchEvent(
    new frameWin.PointerEvent("pointerup", { ...opts, pointerType: "mouse" }),
  );
  el.dispatchEvent(new frameWin.MouseEvent("mouseup", opts));
  el.dispatchEvent(new frameWin.MouseEvent("click", opts));
}

describe("sidebar", function () {
  this.timeout(30000);

  let win: any;
  let frameWin: any;
  let frameDoc: Document;
  const uiErrors: string[] = [];

  before(async function () {
    win = Zotero.getMainWindow();
    const button = win.document.getElementById(BUTTON_ID);
    assert.exists(button, "toolbar toggle button");
    const sidebar = win.document.getElementById(SIDEBAR_ID);
    if (sidebar.collapsed) {
      button.doCommand();
    }
    const iframe = await waitFor(
      () => sidebar.querySelector("iframe") as HTMLIFrameElement | null,
      "sidebar iframe",
    );
    frameDoc = await waitFor(
      () =>
        (iframe.contentDocument?.getElementById("root")?.childElementCount ??
          0) > 0 && iframe.contentDocument,
      "timeline to render",
    );
    frameWin = iframe.contentWindow;
    frameWin.addEventListener("error", (e: ErrorEvent) =>
      uiErrors.push(e.message),
    );
    const origError = frameWin.console.error.bind(frameWin.console);
    frameWin.console.error = (...args: unknown[]) => {
      uiErrors.push(args.map(String).join(" "));
      origError(...args);
    };
  });

  beforeEach(function () {
    uiErrors.length = 0;
  });

  function button(label: string): Element {
    const el = frameDoc.querySelector(`button[aria-label="${label}"]`);
    assert.exists(el, `button "${label}"`);
    return el!;
  }

  it("toggles from the toolbar button and remembers the state", function () {
    const sidebar = win.document.getElementById(SIDEBAR_ID);
    const toggle = win.document.getElementById(BUTTON_ID);
    const pref = `${config.prefsPrefix}.sidebarOpen`;

    toggle.doCommand();
    assert.isTrue(sidebar.collapsed);
    assert.isFalse(Zotero.Prefs.get(pref, true));

    toggle.doCommand();
    assert.isFalse(sidebar.collapsed);
    assert.isTrue(Zotero.Prefs.get(pref, true));
  });

  it("shows task notes from the library", async function () {
    const note = new Zotero.Item("note");
    note.libraryID = Zotero.Libraries.userLibraryID;
    note.setNote("<p>Sidebar shows this task</p><p>[ ] 📅 2026-10-20</p>");
    note.addTag("#task");
    await note.saveTx();
    try {
      await waitFor(
        () => frameDoc.body.textContent?.includes("Sidebar shows this task"),
        "task title in the timeline",
      );
    } finally {
      await note.eraseTx();
    }
  });

  it("rejects edits visibly while the timeline is read-only", async function () {
    const actions = (Zotero as any)[config.addonInstance].data.taskActions;
    let message = "";
    await actions.updateTask({}, {}).catch((e: Error) => (message = e.message));
    assert.isNotEmpty(message);
  });

  // Regression: framer-motion read document.body of the XUL main window.
  it("switches to AI entry without crashing", async function () {
    press(frameWin, button("Switch to AI task entry"));
    await delay(500);
    press(frameWin, button("Switch to manual task entry"));
    await delay(500);
    assert.deepEqual(uiErrors, []);
  });

  // Regression: Floating UI followed frameElement into the XUL main window.
  it("opens the tags filter popover without crashing", async function () {
    press(frameWin, button("Tags filter"));
    await waitFor(
      () => frameDoc.querySelector("[data-radix-popper-content-wrapper]"),
      "tags popover",
    );
    assert.deepEqual(uiErrors, []);
  });
});
