import { assert } from "chai";
import { config } from "../package.json";
import {
  completion,
  delay,
  openTimeline,
  press,
  remountSidebar,
  removePluginLogins,
  waitFor,
} from "./helpers";

const ENDPOINT = `/${config.addonRef}-test/v1/chat/completions`;
const PREFS = config.prefsPrefix;

describe("AI agent in the sidebar", function () {
  this.timeout(60000);

  let data: any;
  let win: any;
  let doc: Document;
  let frameWin: any;
  let savedSettings: string;
  let startedServer = false;
  /** Tool call the mock model makes for the next user message. */
  let nextToolCall: { name: string; args: object } | null = null;
  let requests: any[] = [];
  const created: Zotero.Item[] = [];

  before(async function () {
    // @ts-expect-error - Plugin instance is not typed
    data = Zotero[config.addonInstance].data;
    win = Zotero.getMainWindow();
    savedSettings = Zotero.Prefs.get(`${PREFS}.appSettings`, true) as string;

    // A stand-in for an OpenAI-compatible provider on Zotero's local server.
    function MockEndpoint() {}
    MockEndpoint.prototype = {
      supportedMethods: ["POST"],
      supportedDataTypes: ["application/json"],
      permitBookmarklet: false,
      // The sidebar's fetch looks like a browser request to Zotero 10.
      allowRequestsFromUnsafeWebContent: true,
      init: async (request: any) => {
        const body = request.data;
        requests.push(body);
        const last = body.messages[body.messages.length - 1];
        const reply =
          last.role === "user" && nextToolCall
            ? completion(
                {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: `call_${requests.length}`,
                      type: "function",
                      function: {
                        name: nextToolCall.name,
                        arguments: JSON.stringify(nextToolCall.args),
                      },
                    },
                  ],
                },
                "tool_calls",
              )
            : completion({ role: "assistant", content: "Done." }, "stop");
        return [200, "application/json", JSON.stringify(reply)];
      },
    };
    const server = Zotero.Server as any;
    server.Endpoints[ENDPOINT] = MockEndpoint;
    let port: number;
    try {
      port = server.port;
    } catch {
      // The test profile doesn't start Zotero's local server; start our own.
      port = 23240 + Math.floor(Math.random() * 100);
      server.init(port);
      startedServer = true;
    }

    await data.settingsStore.save({
      aiConfig: {
        enabled: true,
        defaultMode: false,
        activeProvider: "openai-compatible",
        providers: {
          "openai-compatible": {
            apiKey: "test-key",
            baseUrl: `http://127.0.0.1:${port}/${config.addonRef}-test/v1`,
            model: "mock-model",
            useResponsesApi: false,
          },
        },
        systemPrompt: "",
        timeout: null,
      },
    });

    // Remount so the timeline loads the new settings, then enter AI mode.
    Zotero.Prefs.set(`${PREFS}.sidebarOpen`, true, true);
    await remountSidebar(win);
    ({ doc, frameWin } = await openTimeline(win));
    press(
      frameWin,
      await waitFor(
        () => doc.querySelector('button[aria-label="Switch to AI task entry"]'),
        "AI toggle",
      ),
    );
  });

  beforeEach(function () {
    requests = [];
    nextToolCall = null;
  });

  after(async function () {
    delete (Zotero.Server as any).Endpoints[ENDPOINT];
    if (startedServer) (Zotero.Server as any).close();
    Zotero.Prefs.set(`${PREFS}.appSettings`, savedSettings, true);
    for (const item of created) {
      if (Zotero.Items.get(item.id)) await item.eraseTx();
    }
    await removePluginLogins();
    // Leave a fresh timeline (manual entry, default settings) for other suites.
    await remountSidebar(win);
  });

  /** Sends a message and waits until the agent has finished its turn. */
  async function ask(text: string) {
    const input = await waitFor(
      () => doc.querySelector("input") as HTMLInputElement | null,
      "AI input",
    );
    const setter = Object.getOwnPropertyDescriptor(
      frameWin.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, text);
    input.dispatchEvent(new frameWin.Event("input", { bubbles: true }));
    await delay(50);
    input.dispatchEvent(
      new frameWin.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  }

  async function createTaskNote(title: string) {
    const note = new Zotero.Item("note");
    note.libraryID = Zotero.Libraries.userLibraryID;
    note.setNote(`<p>${title}</p><p>[ ]</p>`);
    note.addTag("#task");
    await note.saveTx({ skipSelect: true } as any);
    created.push(note);
    await data.taskStore.reload();
    return note;
  }

  /** The Yes/No button of the confirmation that names this task. */
  function confirmButton(taskTitle: string, label: "Yes" | "No") {
    return waitFor(() => {
      const toast = Array.from(doc.querySelectorAll("div")).find(
        (el) =>
          el.textContent?.includes(`Delete "${taskTitle}"?`) &&
          Array.from(el.querySelectorAll("button")).some(
            (b) => b.textContent?.trim() === "Yes",
          ),
      );
      return Array.from(toast?.querySelectorAll("button") ?? []).find(
        (b) => b.textContent?.trim() === label,
      );
    }, `"${label}" in the confirmation for "${taskTitle}"`);
  }

  /**
   * Answers the confirmation like a user would: once it has finished
   * appearing, click once. (Clicking mid-animation or repeatedly during the
   * exit animation doesn't reflect real use and made this flaky.)
   */
  async function answerConfirmation(taskTitle: string, label: "Yes" | "No") {
    await confirmButton(taskTitle, label);
    await delay(300);
    (await confirmButton(taskTitle, label)).click();
  }

  it("creates a task note from a natural-language request", async function () {
    nextToolCall = {
      name: "create_task",
      args: {
        title: "Read Attention paper via AI",
        dueAt: "2026-10-20",
        priority: "high",
      },
    };
    await ask("Remind me to read the Attention paper by Oct 20");

    const task = await waitFor(
      () =>
        data.taskStore
          .getTasks()
          .find((t: any) => t.title === "Read Attention paper via AI"),
      "AI-created task note",
      20000,
    );
    // Let the tool result round trip finish before asserting.
    await waitFor(() => requests.length >= 2, "tool result round trip");
    const [libraryID, key] = task.id.split("/");
    const note = Zotero.Items.getByLibraryAndKey(Number(libraryID), key)!;
    created.push(note);

    assert.equal(note.libraryID, Zotero.Libraries.userLibraryID);
    assert.include(note.getNote(), "[ ] ⏫ 📅 2026-10-20");
    assert.include(requests[0].messages[0].content, "running inside Zotero");
    assert.include(
      requests[0].tools.map((t: any) => t.function.name),
      "create_task",
    );
    assert.deepEqual(
      requests[1].messages.slice(-2).map((m: any) => m.role),
      ["assistant", "tool"],
    );
    assert.notInclude(
      Zotero.Prefs.get(`${PREFS}.appSettings`, true) as string,
      "test-key",
    );
  });

  it("asks before deleting, and trashes the note when confirmed", async function () {
    const note = await createTaskNote("Delete me via AI");
    nextToolCall = {
      name: "delete_task",
      args: { id: `${note.libraryID}/${note.key}` },
    };
    await ask("Delete the 'Delete me via AI' task");

    await confirmButton("Delete me via AI", "Yes");
    assert.isFalse(Zotero.Items.get(note.id).deleted, "not before confirming");
    await answerConfirmation("Delete me via AI", "Yes");
    await waitFor(() => Zotero.Items.get(note.id).deleted, "note in the trash");
    await waitFor(() => requests.length >= 2, "tool result round trip");
  });

  it("keeps the note when the deletion is declined", async function () {
    const note = await createTaskNote("Keep me via AI");
    nextToolCall = {
      name: "delete_task",
      args: { id: `${note.libraryID}/${note.key}` },
    };
    await ask("Delete the 'Keep me via AI' task");

    await answerConfirmation("Keep me via AI", "No");
    await waitFor(() => requests.length >= 2, "tool result round trip");
    assert.isFalse(Zotero.Items.get(note.id).deleted);
    const toolMessage = requests[1].messages.at(-1);
    assert.equal(toolMessage.role, "tool");
    assert.match(toolMessage.content, /cancel/i);
  });
});
