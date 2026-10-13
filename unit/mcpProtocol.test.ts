import { describe, expect, it } from "vitest";
import {
  handleMcpPost,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "../src/mcp/protocol";
import type { McpServerInfo } from "../src/mcp/protocol";

const server: McpServerInfo = {
  name: "test-server",
  version: "1.0.0",
  instructions: "Use the tools.",
  tools: () => [
    {
      name: "echo",
      description: "Echoes its input",
      inputSchema: { type: "object", properties: { text: { type: "string" } } },
      call: async (args) => ({ echoed: args.text }),
    },
    {
      name: "fails",
      description: "Always fails",
      inputSchema: { type: "object", properties: {} },
      call: async () => {
        throw new Error("Reading annotations is turned off");
      },
    },
  ],
};

const request = (id: number, method: string, params?: object) => ({
  jsonrpc: "2.0",
  id,
  method,
  ...(params ? { params } : {}),
});

describe("handleMcpPost", () => {
  it("negotiates the protocol version on initialize", async () => {
    const reply: any = await handleMcpPost(
      request(1, "initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "c", version: "1" },
      }),
      server,
    );
    expect(reply.result).toMatchObject({
      protocolVersion: "2025-03-26",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "test-server", version: "1.0.0" },
      instructions: "Use the tools.",
    });

    const unknown: any = await handleMcpPost(
      request(2, "initialize", { protocolVersion: "1999-01-01" }),
      server,
    );
    expect(unknown.result.protocolVersion).toBe(SUPPORTED_PROTOCOL_VERSIONS[0]);
  });

  it("lists tools without their implementation", async () => {
    const reply: any = await handleMcpPost(request(1, "tools/list"), server);
    expect(reply.result.tools).toEqual([
      {
        name: "echo",
        description: "Echoes its input",
        inputSchema: {
          type: "object",
          properties: { text: { type: "string" } },
        },
      },
      {
        name: "fails",
        description: "Always fails",
        inputSchema: { type: "object", properties: {} },
      },
    ]);
  });

  it("returns tool results as JSON text", async () => {
    const reply: any = await handleMcpPost(
      request(3, "tools/call", { name: "echo", arguments: { text: "hi" } }),
      server,
    );
    expect(reply).toEqual({
      jsonrpc: "2.0",
      id: 3,
      result: { content: [{ type: "text", text: '{"echoed":"hi"}' }] },
    });
  });

  it("reports tool failures as error results the model can read", async () => {
    const reply: any = await handleMcpPost(
      request(4, "tools/call", { name: "fails", arguments: {} }),
      server,
    );
    expect(reply.result).toEqual({
      content: [{ type: "text", text: "Reading annotations is turned off" }],
      isError: true,
    });
  });

  it("uses JSON-RPC errors for protocol problems", async () => {
    const unknownTool: any = await handleMcpPost(
      request(5, "tools/call", { name: "nope" }),
      server,
    );
    expect(unknownTool.error).toMatchObject({ code: -32602 });
    const unknownMethod: any = await handleMcpPost(
      request(6, "resources/list"),
      server,
    );
    expect(unknownMethod.error).toMatchObject({ code: -32601 });
    const notJsonRpc: any = await handleMcpPost(
      { id: 7, method: "ping" },
      server,
    );
    expect(notJsonRpc.error).toMatchObject({ code: -32600 });
  });

  it("does not reply to notifications", async () => {
    expect(
      await handleMcpPost(
        { jsonrpc: "2.0", method: "notifications/initialized" },
        server,
      ),
    ).toBeNull();
  });

  it("handles batches, replying only to requests", async () => {
    const reply = await handleMcpPost(
      [
        { jsonrpc: "2.0", method: "notifications/initialized" },
        request(8, "ping"),
      ],
      server,
    );
    expect(reply).toEqual([{ jsonrpc: "2.0", id: 8, result: {} }]);
  });
});
