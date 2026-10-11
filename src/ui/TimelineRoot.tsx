import { Component, useMemo, useState, useSyncExternalStore } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { TasksTimelineApp } from "@tasks-timeline/components";
import type { Task } from "@tasks-timeline/components";
import { SessionSettingsRepository } from "./SessionSettingsRepository";

interface ErrorBoundaryProps {
  onError: (error: Error) => void;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

class TimelineErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    this.props.onError(error);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: "20px", textAlign: "center" }}>
          <h3>Tasks Timeline crashed</h3>
          <p>{this.state.error.message}</p>
          <button onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function useSystemDarkMode(win: Window): boolean {
  const query = useMemo(() => {
    const result = win.matchMedia("(prefers-color-scheme: dark)");
    if (!result) {
      throw new Error("matchMedia is unavailable in this window");
    }
    return result;
  }, [win]);
  return useSyncExternalStore(
    (onChange) => {
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => query.matches,
  );
}

/**
 * M0: tasks live in component state only. Reading and writing Zotero notes
 * arrives in M1/M2 through the core's task store.
 */
function SessionTimeline({ win }: { win: Window }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const settingsRepository = useMemo(() => new SessionSettingsRepository(), []);
  const systemInDarkMode = useSystemDarkMode(win);

  return (
    <TasksTimelineApp
      tasks={tasks}
      settingsRepository={settingsRepository}
      systemInDarkMode={systemInDarkMode}
      onTaskAdded={(task) => setTasks((prev) => [...prev, task])}
      onTaskUpdated={(task) =>
        setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)))
      }
      onTaskDeleted={(taskId) =>
        setTasks((prev) => prev.filter((t) => t.id !== taskId))
      }
    />
  );
}

export function TimelineRoot({
  win,
  onError,
}: {
  win: Window;
  onError: (error: Error) => void;
}) {
  return (
    <TimelineErrorBoundary onError={onError}>
      <SessionTimeline win={win} />
    </TimelineErrorBoundary>
  );
}
