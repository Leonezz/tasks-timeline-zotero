/** Shared helpers for Zotero integration tests that drive the sidebar. */
import { config } from "../package.json";

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitFor<T>(
  check: () => T | null | undefined | false,
  what: string,
  timeoutMs = 10000,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = check();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

export function press(frameWin: any, el: Element) {
  const opts = { bubbles: true, cancelable: true, composed: true, button: 0 };
  el.dispatchEvent(
    new frameWin.PointerEvent("pointerdown", { ...opts, pointerType: "mouse" }),
  );
  el.dispatchEvent(new frameWin.MouseEvent("mousedown", opts));
  el.dispatchEvent(
    new frameWin.PointerEvent("pointerup", { ...opts, pointerType: "mouse" }),
  );
  el.dispatchEvent(new frameWin.MouseEvent("mouseup", opts));
  el.dispatchEvent(new frameWin.MouseEvent("click", opts));
}

/** OpenAI chat-completions response with either tool calls or text. */
export function completion(message: object, finishReason: string) {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "mock-model",
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

export async function remountSidebar(win: any) {
  // @ts-expect-error - Plugin instance is not typed
  const hooks = Zotero[config.addonInstance].hooks;
  await hooks.onMainWindowUnload(win);
  await hooks.onMainWindowLoad(win);
}

export async function openTimeline(win: any) {
  const iframe = await waitFor(
    () =>
      win.document.querySelector(
        `#${config.addonRef}-sidebar iframe`,
      ) as HTMLIFrameElement | null,
    "sidebar iframe",
  );
  const doc = await waitFor(
    () =>
      (iframe.contentDocument?.getElementById("root")?.childElementCount ?? 0) >
        0 && iframe.contentDocument,
    "timeline to render",
  );
  return { doc, frameWin: iframe.contentWindow as any };
}
