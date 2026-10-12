import { getPref, setPref } from "../utils/prefs";
import type { ZoteroPrefsBridge } from "../shared/uiContract";

export const getTaskTag = (): string => getPref("taskTag");

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
  };
}
