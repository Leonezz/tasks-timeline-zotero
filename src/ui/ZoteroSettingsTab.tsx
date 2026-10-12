import { useState } from "react";
import type { ZoteroPrefsBridge } from "../shared/uiContract";

/** Content of the "Zotero" tab in the timeline's settings page. */
export function ZoteroSettingsTab({ prefs }: { prefs: ZoteroPrefsBridge }) {
  const [saved, setSaved] = useState(prefs.getTaskTag());
  const [draft, setDraft] = useState(saved);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    try {
      prefs.setTaskTag(draft);
      const current = prefs.getTaskTag();
      setSaved(current);
      setDraft(current);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex flex-col gap-3 p-1">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-slate-700">Task tag</span>
        <div className="flex gap-2">
          <input
            aria-label="Task tag"
            className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-1 text-sm disabled:opacity-50"
            disabled={draft.trim() === saved}
            onClick={save}
          >
            Save
          </button>
        </div>
      </label>
      {error && (
        <p role="alert" className="text-sm text-rose-600">
          {error}
        </p>
      )}
      <p className="text-xs text-slate-500">
        Notes with this tag are shown as tasks, in My Library and group
        libraries. Changing it does not retag existing notes.
      </p>
    </div>
  );
}
