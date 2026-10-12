import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import componentStyles from "@tasks-timeline/components/index.css";
import hostStyles from "./host.css";
import { TimelineRoot } from "./TimelineRoot";
import { UI_READY_EVENT } from "../shared/uiContract";
import type {
  MountedTimeline,
  MountOptions,
  TimelineUI,
} from "../shared/uiContract";

/**
 * Runs inside content/timeline.html, a regular HTML document. The component
 * library's dependencies (Radix, framer-motion, react-remove-scroll) need
 * document.body, which the XUL main window does not have.
 */
function mount(rootEl: HTMLElement, options: MountOptions): MountedTimeline {
  const doc = rootEl.ownerDocument;
  const win = doc?.defaultView;
  if (!doc || !win || !doc.body || !doc.head) {
    throw new Error("Timeline root must live in an HTML document with a body");
  }

  const styleEl = doc.createElement("style");
  styleEl.textContent = `${componentStyles}\n${hostStyles}`;
  doc.head.appendChild(styleEl);
  rootEl.className = "tasks-timeline-app";

  const root = createRoot(rootEl, {
    onUncaughtError: (error) => options.onError(toError(error)),
  });
  root.render(
    <StrictMode>
      <TimelineRoot
        win={win}
        taskSource={options.taskSource}
        taskActions={options.taskActions}
        settings={options.settings}
        zoteroPrefs={options.zoteroPrefs}
        ai={options.ai}
        onError={options.onError}
      />
    </StrictMode>,
  );

  return {
    unmount: () => {
      root.unmount();
      styleEl.remove();
    },
    diagnostics: () => ({
      hasBody: doc.body !== null,
      styleTextLength: styleEl.textContent?.length ?? 0,
      appRootRendered: rootEl.childElementCount > 0,
    }),
  };
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

const ui: TimelineUI = { mount };
export default ui;

/**
 * Floating UI (used by Radix popovers) follows window.frameElement out of this
 * frame and calls getComputedStyle(document.body) on the parent document. The
 * parent is Zotero's XUL main window, which has no body, so every dropdown
 * crashed. The timeline never needs to see past its own frame.
 */
function sealFrameBoundary(win: Window): void {
  Object.defineProperty(win, "frameElement", {
    configurable: true,
    enumerable: true,
    get: () => null,
  });
}

// The script tag sits at the end of <body>, so the document is ready here.
// The global is assigned only after this IIFE returns, so defer the signal.
// (The sandbox typings used for this project do not declare `window`.)
const frameWindow = globalThis as unknown as Window;
const frame = frameWindow.frameElement;
if (!frame) {
  throw new Error("Tasks Timeline UI must be loaded inside its sidebar frame");
}
sealFrameBoundary(frameWindow);
queueMicrotask(() => {
  frame.dispatchEvent(new CustomEvent(UI_READY_EVENT));
});
