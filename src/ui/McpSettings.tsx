import { useState } from "react";
import type { McpStatus } from "../mcp/mcpServer";
import type { ZoteroPrefsBridge } from "../shared/uiContract";

/** Copies values across the core/frame realm boundary. */
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const BUTTON =
  "rounded-md border border-slate-300 px-2 py-1 text-xs disabled:opacity-50";

/** The MCP part of the "Zotero" settings tab. */
export function McpSettings({ prefs }: { prefs: ZoteroPrefsBridge }) {
  const [status, setStatus] = useState<McpStatus>(() =>
    clone(prefs.getMcpStatus()),
  );
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = (action: () => Promise<McpStatus>) =>
    action()
      .then((next) => {
        setStatus(clone(next));
        setError(null);
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : String(e)),
      );

  const command =
    status.url && status.token
      ? `claude mcp add --transport http zotero-tasks ${status.url} --header "Authorization: Bearer ${status.token}"`
      : "";

  return (
    <fieldset className="flex flex-col gap-1.5 border-t border-slate-200 pt-3">
      <legend className="text-sm font-medium text-slate-700">
        External AI agents (MCP)
      </legend>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          aria-label="Allow MCP clients"
          checked={status.enabled}
          onChange={(e) => run(() => prefs.setMcpEnabled(e.target.checked))}
        />
        Allow MCP clients on this computer (e.g. Claude Code)
      </label>
      <p className="text-xs text-slate-500">
        Clients with the token can read and edit your tasks and read your
        library within the limits above. Deleting tasks isn&apos;t available to
        them.
      </p>
      {status.enabled && status.error && (
        <p role="alert" className="text-sm text-rose-600">
          {status.error}
        </p>
      )}
      {status.enabled && status.url && status.token && (
        <div className="flex flex-col gap-1.5 text-xs">
          <div>
            <span className="text-slate-500">URL </span>
            <code aria-label="MCP URL">{status.url}</code>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-500">Token</span>
            <code aria-label="MCP token">
              {showToken ? status.token : "•".repeat(16)}
            </code>
            <button
              type="button"
              className={BUTTON}
              onClick={() => setShowToken((v) => !v)}
            >
              {showToken ? "Hide" : "Show"}
            </button>
            <button
              type="button"
              className={BUTTON}
              onClick={() => prefs.copyToClipboard(status.token!)}
            >
              Copy token
            </button>
            <button
              type="button"
              className={BUTTON}
              onClick={() => run(() => prefs.regenerateMcpToken())}
            >
              Regenerate
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500">Claude Code</span>
            <button
              type="button"
              className={BUTTON}
              onClick={() => prefs.copyToClipboard(command)}
            >
              Copy setup command
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-rose-600">
          {error}
        </p>
      )}
    </fieldset>
  );
}
