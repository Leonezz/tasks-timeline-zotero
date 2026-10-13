import { getPref, setPref } from "../utils/prefs";
import type { LibraryAccess } from "../ai/libraryTools";
import type { ZoteroPrefsBridge } from "../shared/uiContract";

export const getTaskTag = (): string => getPref("taskTag");

/** What the AI may read from the library beyond bibliographic metadata. */
export const getLibraryAccess = (): LibraryAccess => ({
  abstracts: getPref("aiReadAbstracts"),
  annotations: getPref("aiReadAnnotations"),
  fulltext: getPref("aiReadFulltext"),
});

export function createZoteroPrefsBridge(): ZoteroPrefsBridge {
  return {
    getTaskTag,
    setTaskTag: (tag: string) => {
      const trimmed = tag.trim();
      if (!trimmed) {
        throw new Error("The task tag can't be empty.");
      }
      setPref("taskTag", trimmed);
    },
    getLibraryAccess,
    setLibraryAccess: (access: Partial<LibraryAccess>) => {
      if (access.abstracts !== undefined) {
        setPref("aiReadAbstracts", access.abstracts);
      }
      if (access.annotations !== undefined) {
        setPref("aiReadAnnotations", access.annotations);
      }
      if (access.fulltext !== undefined) {
        setPref("aiReadFulltext", access.fulltext);
      }
    },
  };
}
