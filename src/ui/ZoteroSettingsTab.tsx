import { useState } from "react";
import type { LibraryAccess } from "../ai/libraryTools";
import type { ZoteroPrefsBridge } from "../shared/uiContract";

const ACCESS_OPTIONS: { key: keyof LibraryAccess; label: string }[] = [
  { key: "abstracts", label: "Abstracts" },
  { key: "annotations", label: "Highlights and annotations" },
  { key: "fulltext", label: "Full text of attachments" },
];

/** Content of the "Zotero" tab in the timeline's settings page. */
export function ZoteroSettingsTab({ prefs }: { prefs: ZoteroPrefsBridge }) {
  const [saved, setSaved] = useState(prefs.getTaskTag());
  const [draft, setDraft] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const [access, setAccess] = useState(() => prefs.getLibraryAccess());

  const toggleAccess = (key: keyof LibraryAccess, value: boolean) => {
    prefs.setLibraryAccess({ [key]: value });
    setAccess(prefs.getLibraryAccess());
  };

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
      <fieldset className="flex flex-col gap-1.5 border-t border-slate-200 pt-3">
        <legend className="text-sm font-medium text-slate-700">
          AI may read from your library
        </legend>
        <p className="text-xs text-slate-500">
          Titles, authors, years and tags are always available to the AI.
          Anything checked here is sent to your AI provider when the assistant
          uses it.
        </p>
        {ACCESS_OPTIONS.map(({ key, label }) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              aria-label={label}
              checked={access[key]}
              onChange={(e) => toggleAccess(key, e.target.checked)}
            />
            {label}
          </label>
        ))}
      </fieldset>
    </div>
  );
}
