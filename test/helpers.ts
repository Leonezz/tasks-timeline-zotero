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

/** Removes every login the plugin stored (sync or async API, per Firefox). */
export async function removePluginLogins() {
  const logins = Services.logins as any;
  for (const login of await logins.searchLoginsAsync({
    origin: `chrome://${config.addonRef}`,
  })) {
    if (logins.removeLoginAsync) await logins.removeLoginAsync(login);
    else logins.removeLogin(login);
  }
}

// Smallest file Zotero recognizes as a PDF; annotations don't need real pages.
export const MINIMAL_PDF =
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
  "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n" +
  "trailer<</Root 1 0 R>>\n%%EOF\n";

export async function importFile(
  name: string,
  contents: string,
  parentItemID: number,
): Promise<Zotero.Item> {
  const path = PathUtils.join(PathUtils.tempDir, name);
  await IOUtils.writeUTF8(path, contents);
  const attachment = await Zotero.Attachments.importFromFile({
    file: path,
    parentItemID,
  });
  await IOUtils.remove(path);
  return attachment;
}

/** A journal article with a PDF carrying the given annotations. */
export async function createAnnotatedPaper(
  title: string,
  annotations: { text?: string; comment?: string; page?: string }[],
): Promise<{ paper: Zotero.Item; pdf: Zotero.Item }> {
  const paper = new Zotero.Item("journalArticle");
  paper.libraryID = Zotero.Libraries.userLibraryID;
  paper.setField("title", title);
  await paper.saveTx({ skipSelect: true } as any);
  const pdf = await importFile(`${paper.key}.pdf`, MINIMAL_PDF, paper.id);
  for (const [index, a] of annotations.entries()) {
    const annotation = new Zotero.Item("annotation") as any;
    annotation.libraryID = pdf.libraryID;
    annotation.parentID = pdf.id;
    annotation.annotationType = a.text ? "highlight" : "note";
    annotation.annotationText = a.text ?? "";
    annotation.annotationComment = a.comment ?? "";
    annotation.annotationColor = "#ffd400";
    annotation.annotationPageLabel = a.page ?? "1";
    annotation.annotationSortIndex = `0000${index}|000000|00000`;
    annotation.annotationPosition = JSON.stringify({
      pageIndex: 0,
      rects: [[10, 10 + index * 20, 50, 20 + index * 20]],
    });
    await annotation.saveTx();
  }
  return { paper, pdf };
}
