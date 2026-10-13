/**
 * Minimal MCP server over JSON-RPC 2.0 (tools only, stateless). Pure: the
 * HTTP endpoint and the Zotero-backed tools are passed in, so this runs under
 * Node unit tests.
 *
 * Spec: https://modelcontextprotocol.io/specification
 */

export const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
];

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Resolves with the tool's result, or rejects with a user-facing message. */
  call: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface McpServerInfo {
  name: string;
  version: string;
  instructions: string;
  tools: () => McpTool[];
}

type JsonRpcId = string | number;

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export const JSON_RPC_ERRORS = {
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const errorResponse = (
  id: JsonRpcId | null,
  code: number,
  message: string,
): JsonRpcResponse => ({ jsonrpc: "2.0", id, error: { code, message } });

async function handleRequest(
  method: string,
  params: Record<string, unknown>,
  server: McpServerInfo,
): Promise<unknown> {
  switch (method) {
    case "initialize": {
      const requested = params.protocolVersion;
      return {
        protocolVersion:
          typeof requested === "string" &&
          SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
            ? requested
            : SUPPORTED_PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: server.name, version: server.version },
        instructions: server.instructions,
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return {
        tools: server.tools().map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      };
    case "tools/call": {
      const name = params.name;
      const args = params.arguments ?? {};
      if (typeof name !== "string" || !isObject(args)) {
        throw new RpcError(
          JSON_RPC_ERRORS.invalidParams,
          "tools/call needs a tool name and an arguments object",
        );
      }
      const tool = server.tools().find((t) => t.name === name);
      if (!tool) {
        throw new RpcError(
          JSON_RPC_ERRORS.invalidParams,
          `Unknown tool: ${name}`,
        );
      }
      // Tool failures are results the model can read, not protocol errors.
      try {
        const result = await tool.call(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: message }], isError: true };
      }
    }
    default:
      throw new RpcError(
        JSON_RPC_ERRORS.methodNotFound,
        `Method not supported: ${method}`,
      );
  }
}

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

async function handleOne(
  message: unknown,
  server: McpServerInfo,
): Promise<JsonRpcResponse | null> {
  if (!isObject(message) || message.jsonrpc !== "2.0") {
    return errorResponse(
      null,
      JSON_RPC_ERRORS.invalidRequest,
      "Not a JSON-RPC 2.0 message",
    );
  }
  const id = message.id as JsonRpcId | undefined;
  const isRequest = typeof message.method === "string" && id !== undefined;
  // Notifications and responses from the client need no reply.
  if (!isRequest) return null;
  if (typeof id !== "string" && typeof id !== "number") {
    return errorResponse(
      null,
      JSON_RPC_ERRORS.invalidRequest,
      "Invalid request id",
    );
  }
  const params = message.params ?? {};
  if (!isObject(params)) {
    return errorResponse(
      id,
      JSON_RPC_ERRORS.invalidParams,
      "params must be an object",
    );
  }
  try {
    const result = await handleRequest(
      message.method as string,
      params,
      server,
    );
    return { jsonrpc: "2.0", id, result };
  } catch (error) {
    if (error instanceof RpcError)
      return errorResponse(id, error.code, error.message);
    throw error;
  }
}

/**
 * Handles one POSTed JSON-RPC message or batch. Returns the reply body, or
 * null when nothing needs a reply (only notifications/responses were sent;
 * the HTTP layer answers 202 Accepted).
 */
export async function handleMcpPost(
  body: unknown,
  server: McpServerInfo,
): Promise<unknown | null> {
  if (Array.isArray(body)) {
    if (body.length === 0) {
      return errorResponse(null, JSON_RPC_ERRORS.invalidRequest, "Empty batch");
    }
    const replies = (
      await Promise.all(body.map((m) => handleOne(m, server)))
    ).filter((r): r is JsonRpcResponse => r !== null);
    return replies.length > 0 ? replies : null;
  }
  return handleOne(body, server);
}
