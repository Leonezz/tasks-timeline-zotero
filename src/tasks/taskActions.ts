import { getString } from "../utils/locale";
import type { TaskActions } from "../shared/uiContract";

/**
 * M1 is read-only: every edit from the timeline is rejected with a visible
 * message instead of being dropped. M2 replaces this with note writes.
 */
export function createReadOnlyTaskActions(): TaskActions {
  const reject = () => Promise.reject(new Error(getString("error-read-only")));
  return {
    addTask: reject,
    updateTask: reject,
    deleteTask: reject,
  };
}
