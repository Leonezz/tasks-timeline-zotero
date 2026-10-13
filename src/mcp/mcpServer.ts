/**
 * Serves MCP (Streamable HTTP, JSON responses, stateless) on Zotero's local
 * server. Zotero itself only accepts localhost Host headers and drops
 * browser-like requests; on top of that every request needs the bearer token.
 */
import { config } from "../../package.json";
import type { SecretStore } from "../settings/secretStore";
import { handleMcpPost } from "./protocol";
import type { McpServerInfo } from "./protocol";

export const MCP_PATH = `/${config.addonRef}/mcp`;
const TOKEN_SECRET = "mcp.token";

// Status lines Zotero's server table lacks; added while the endpoint exists.
const STATUS_TEXT: Record<number, string> = {
  202: "Accepted",
  401: "Unauthorized",
  405: "Method Not Allowed",
};

interface ServerInternals {
  Endpoints: Record<string, unknown>;
  responseCodes: Record<number, string>;
  port: number;
}

const zoteroServer = () => Zotero.Server as unknown as ServerInternals;

interface McpRequest {
  method: string;
  /** Lower-cased header names. */
  headers: Record<string, string>;
  data: unknown;
}

export interface McpStatus {
  enabled: boolean;
  url?: string;
  token?: string;
  /** Why the server can't be reached even though it's enabled. */
  error?: string;
}

/** Compares without leaking where the strings differ. */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function newToken(): string {
  const bytes = new Uint8Array(32);
  Zotero.getMainWindow().crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export class McpServer {
  private token: string | null = null;
  private addedStatusCodes: number[] = [];

  constructor(
    private readonly secrets: SecretStore,
    private readonly info: McpServerInfo,
  ) {}

  get running(): boolean {
    return this.token !== null;
  }

  async start(): Promise<void> {
    let token = await this.secrets.get(TOKEN_SECRET);
    if (!token) {
      token = newToken();
      await this.secrets.set(TOKEN_SECRET, token);
    }
    this.token = token;
    const server = zoteroServer();
    for (const [code, text] of Object.entries(STATUS_TEXT)) {
      if (!(Number(code) in server.responseCodes)) {
        server.responseCodes[Number(code)] = text;
        this.addedStatusCodes.push(Number(code));
      }
    }
    server.Endpoints[MCP_PATH] = this.endpointClass();
  }

  stop(): void {
    const server = zoteroServer();
    delete server.Endpoints[MCP_PATH];
    for (const code of this.addedStatusCodes) delete server.responseCodes[code];
    this.addedStatusCodes = [];
    this.token = null;
  }

  /** Replaces the token; clients using the old one are rejected at once. */
  async regenerateToken(): Promise<void> {
    const token = newToken();
    await this.secrets.set(TOKEN_SECRET, token);
    if (this.running) this.token = token;
  }

  status(): McpStatus {
    if (!this.running) return { enabled: false };
    let port: number;
    try {
      port = zoteroServer().port;
    } catch {
      return {
        enabled: true,
        token: this.token!,
        error:
          "Zotero's local server is off. Turn on “Allow other applications on this computer to communicate with Zotero” in Zotero's Advanced settings.",
      };
    }
    return {
      enabled: true,
      token: this.token!,
      url: `http://127.0.0.1:${port}${MCP_PATH}`,
    };
  }

  private endpointClass() {
    // Zotero instantiates the class per request; the arrow keeps `this`.
    const handle = (request: McpRequest) => this.handle(request);
    function Endpoint() {}
    Endpoint.prototype = {
      supportedMethods: ["GET", "POST", "DELETE"],
      supportedDataTypes: ["application/json"],
      init: handle,
    };
    return Endpoint;
  }

  private async handle(
    request: McpRequest,
  ): Promise<[number, Record<string, string>, string]> {
    const auth = request.headers.authorization ?? "";
    const presented = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!this.token || !presented || !sameSecret(presented, this.token)) {
      return [
        401,
        {
          "Content-Type": "application/json",
          "WWW-Authenticate": `Bearer realm="${config.addonName}"`,
        },
        JSON.stringify({ error: "Missing or invalid bearer token" }),
      ];
    }
    if (request.method !== "POST") {
      // No server-initiated stream and no sessions to delete.
      return [
        405,
        { Allow: "POST", "Content-Type": "text/plain" },
        "Use POST\n",
      ];
    }
    try {
      const reply = await handleMcpPost(request.data, this.info);
      if (reply === null) return [202, {}, ""];
      return [
        200,
        { "Content-Type": "application/json" },
        JSON.stringify(reply),
      ];
    } catch (error) {
      Zotero.logError(error as Error);
      return [
        500,
        { "Content-Type": "application/json" },
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32603, message: (error as Error).message },
        }),
      ];
    }
  }
}
