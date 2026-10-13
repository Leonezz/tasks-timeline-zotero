import { assert } from "chai";
import { config } from "../package.json";
import { waitFor } from "./helpers";

const PREFS = config.prefsPrefix;

describe("MCP server", function () {
  this.timeout(30000);

  let data: any;
  let startedServer = false;
  let url: string;
  let token: string;
  const created: Zotero.Item[] = [];

  /** POSTs like a non-browser MCP client (Zotero drops browser requests). */
  async function post(body: unknown, auth: string | null = `Bearer ${token}`) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "Zotero-Allowed-Request": "1",
    };
    if (auth) headers.Authorization = auth;
    const xhr = await Zotero.HTTP.request("POST", url, {
      headers,
      body: JSON.stringify(body),
      successCodes: false,
      responseType: "text",
    } as any);
    return {
      status: xhr.status,
      body: (xhr.getResponseHeader("Content-Type") ?? "").includes("json")
        ? JSON.parse(xhr.responseText)
        : xhr.responseText,
      header: (name: string) => xhr.getResponseHeader(name),
    };
  }

  let nextId = 1;
  const rpc = (method: string, params?: object) =>
    post({ jsonrpc: "2.0", id: nextId++, method, params });
  const callTool = async (name: string, args: object = {}) => {
    const reply = await rpc("tools/call", { name, arguments: args });
    const { content, isError } = reply.body.result;
    return { isError: Boolean(isError), value: content[0].text };
  };

  before(async function () {
    // @ts-expect-error - Plugin instance is not typed
    data = Zotero[config.addonInstance].data;
    const server = Zotero.Server as any;
    try {
      void server.port;
    } catch {
      // The test profile doesn't start Zotero's local server; start it.
      await server.init(23340 + Math.floor(Math.random() * 100));
      startedServer = true;
    }
    url = `http://127.0.0.1:${server.port}/${config.addonRef}/mcp`;
  });

  after(async function () {
    Zotero.Prefs.set(`${PREFS}.mcpEnabled`, false, true);
    await waitFor(() => !data.mcpServer.running, "MCP server to stop");
    if (startedServer) (Zotero.Server as any).close();
    for (const item of created) {
      if (Zotero.Items.get(item.id)) await item.eraseTx();
    }
  });

  it("does not exist until enabled", async function () {
    assert.isFalse(data.mcpServer.running);
    const reply = await post({ jsonrpc: "2.0", id: 0, method: "ping" }, null);
    assert.equal(reply.status, 404);
  });

  it("creates a token when enabled", async function () {
    Zotero.Prefs.set(`${PREFS}.mcpEnabled`, true, true);
    await waitFor(() => data.mcpServer.running, "MCP server to start");
    const status = data.mcpServer.status();
    assert.equal(status.url, url);
    assert.match(status.token, /^[0-9a-f]{64}$/);
    token = status.token;
  });

  it("rejects requests without the right bearer token", async function () {
    for (const auth of [null, "Bearer wrong", `Basic ${token}`]) {
      const reply = await post({ jsonrpc: "2.0", id: 0, method: "ping" }, auth);
      assert.equal(reply.status, 401, `auth: ${auth}`);
      assert.match(reply.header("WWW-Authenticate") ?? "", /^Bearer /);
    }
  });

  it("completes the MCP handshake", async function () {
    const init = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    assert.equal(init.status, 200);
    assert.include(init.body.result, { protocolVersion: "2025-06-18" });
    assert.equal(init.body.result.serverInfo.name, "zotero-tasks-timeline");
    assert.include(init.body.result.instructions, "running inside Zotero");

    const initialized = await post({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    assert.equal(initialized.status, 202);
  });

  it("offers task and library tools but nothing needing confirmation", async function () {
    const names = (await rpc("tools/list")).body.result.tools.map(
      (t: any) => t.name,
    );
    for (const name of [
      "query_tasks",
      "create_task",
      "update_task",
      "complete_task",
      "search_library",
      "get_item",
      "create_task_for_item",
    ]) {
      assert.include(names, name);
    }
    for (const name of [
      "delete_task",
      "batch_update_tasks",
      "tasks_from_annotations",
      "update_view_settings",
      "ask_user",
    ]) {
      assert.notInclude(names, name);
    }
  });

  it("creates, finds, updates and completes task notes", async function () {
    const create = await callTool("create_task", {
      title: "Task from MCP",
      dueAt: "2026-12-01",
    });
    assert.isFalse(create.isError, create.value);
    // The id returned is the note's real id, usable right away.
    const { id } = JSON.parse(create.value);
    assert.match(id, /^\d+\/[A-Z0-9]{8}$/);
    const [libraryID, key] = id.split("/");
    const note = Zotero.Items.getByLibraryAndKey(Number(libraryID), key)!;
    created.push(note);
    assert.include(note.getNote(), "[ ] 📅 2026-12-01");

    const query = await callTool("query_tasks", { search: "Task from MCP" });
    assert.include(query.value, id);

    const update = await callTool("update_task", {
      id,
      title: "Task from MCP (renamed)",
    });
    assert.isFalse(update.isError, update.value);
    assert.include(note.getNote(), "Task from MCP (renamed)");

    const complete = await callTool("complete_task", { id });
    assert.isFalse(complete.isError, complete.value);
    assert.include(note.getNote(), "[x]");
  });

  it("applies the library privacy switches", async function () {
    const paper = new Zotero.Item("journalArticle");
    paper.libraryID = Zotero.Libraries.userLibraryID;
    paper.setField("title", "Private abstract (MCP test)");
    paper.setField("abstractNote", "Secret findings.");
    await paper.saveTx({ skipSelect: true } as any);
    created.push(paper);

    Zotero.Prefs.set(`${PREFS}.aiReadAbstracts`, false, true);
    const item = await callTool("get_item", {
      ref: `${paper.libraryID}/${paper.key}`,
    });
    assert.notInclude(item.value, "Secret findings");

    const annotations = await callTool("get_annotations", {
      ref: `${paper.libraryID}/${paper.key}`,
    });
    assert.isTrue(annotations.isError);
    assert.match(annotations.value, /turned off/);
  });

  it("only accepts POST", async function () {
    const xhr = await Zotero.HTTP.request("GET", url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Zotero-Allowed-Request": "1",
      },
      successCodes: false,
    } as any);
    assert.equal(xhr.status, 405);
  });

  it("stops accepting the old token after regenerating", async function () {
    const old = token;
    await data.mcpServer.regenerateToken();
    token = data.mcpServer.status().token;
    assert.notEqual(token, old);
    assert.equal(
      (await post({ jsonrpc: "2.0", id: 0, method: "ping" }, `Bearer ${old}`))
        .status,
      401,
    );
    assert.equal((await rpc("ping")).status, 200);
  });

  it("goes away when disabled", async function () {
    Zotero.Prefs.set(`${PREFS}.mcpEnabled`, false, true);
    await waitFor(() => !data.mcpServer.running, "MCP server to stop");
    assert.equal((await rpc("ping")).status, 404);
  });
});
