import { Component, useMemo, useSyncExternalStore } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { TasksTimelineApp } from "@tasks-timeline/components";
import type { Task } from "@tasks-timeline/components";
import { SessionSettingsRepository } from "./SessionSettingsRepository";
import type { TaskActions, TaskSource } from "../shared/uiContract";

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
 * Tasks are created in the core's realm; copy them into this frame's realm so
 * library code never sees cross-compartment arrays or objects.
 */
function useZoteroTasks(source: TaskSource): Task[] {
  const snapshot = useSyncExternalStore(source.subscribe, source.getTasks);
  return useMemo(
    () => JSON.parse(JSON.stringify(snapshot)) as Task[],
    [snapshot],
  );
}

interface TimelineProps {
  win: Window;
  taskSource: TaskSource;
  taskActions: TaskActions;
  onError: (error: Error) => void;
}

function ZoteroTimeline({
  win,
  taskSource,
  taskActions,
  onError,
}: TimelineProps) {
  const tasks = useZoteroTasks(taskSource);
  const settingsRepository = useMemo(() => new SessionSettingsRepository(), []);
  const systemInDarkMode = useSystemDarkMode(win);
  const report = (promise: Promise<void>) =>
    promise.catch((error: unknown) =>
      onError(error instanceof Error ? error : new Error(String(error))),
    );

  return (
    <TasksTimelineApp
      tasks={tasks}
      settingsRepository={settingsRepository}
      systemInDarkMode={systemInDarkMode}
      onTaskAdded={(task) => report(taskActions.addTask(task))}
      onTaskUpdated={(task, previous) =>
        report(taskActions.updateTask(task, previous))
      }
      onTaskDeleted={(taskId, previous) =>
        report(taskActions.deleteTask(taskId, previous))
      }
    />
  );
}

export function TimelineRoot(props: TimelineProps) {
  return (
    <TimelineErrorBoundary onError={props.onError}>
      <ZoteroTimeline {...props} />
    </TimelineErrorBoundary>
  );
}
