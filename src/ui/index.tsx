import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import componentStyles from "@tasks-timeline/components/index.css";
import hostStyles from "./host.css";
import { TimelineRoot } from "./TimelineRoot";
import type {
  MountedTimeline,
  MountOptions,
  TimelineUI,
} from "../shared/uiContract";

const XHTML_NS = "http://www.w3.org/1999/xhtml";

function mount(host: HTMLElement, options: MountOptions): MountedTimeline {
  const doc = host.ownerDocument;
  const win = doc?.defaultView;
  if (!doc || !win) {
    throw new Error("Timeline host is not attached to a window");
  }
  const shadowRoot = host.shadowRoot ?? host.attachShadow({ mode: "open" });

  const styleEl = doc.createElementNS(XHTML_NS, "style") as HTMLStyleElement;
  styleEl.textContent = `${componentStyles}\n${hostStyles}`;
  const rootEl = doc.createElementNS(XHTML_NS, "div") as HTMLDivElement;
  rootEl.className = "tasks-timeline-app";
  shadowRoot.replaceChildren(styleEl, rootEl);

  const root = createRoot(rootEl, {
    onUncaughtError: (error) => options.onError(toError(error)),
  });
  root.render(
    <StrictMode>
      <TimelineRoot win={win} onError={options.onError} />
    </StrictMode>,
  );

  return {
    unmount: () => {
      root.unmount();
      shadowRoot.replaceChildren();
    },
    diagnostics: () => ({
      hasShadowRoot: host.shadowRoot !== null,
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
