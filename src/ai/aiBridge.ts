import type { AiBridge } from "../shared/uiContract";
import { getLibraryAccess } from "../settings/zoteroPrefs";
import { createLibraryTools } from "./libraryTools";
import { zoteroSystemPrompt } from "./systemPrompt";

export function createAiBridge(): AiBridge {
  const tools = createLibraryTools(getLibraryAccess);
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  return {
    systemPrompt: zoteroSystemPrompt,
    tools: () =>
      tools.map(({ name, description, schema }) => ({
        name,
        description,
        schema,
      })),
    executeTool: async (name, args) => {
      const tool = byName.get(name);
      if (!tool) throw new Error(`Unknown Zotero tool "${name}"`);
      return tool.execute(args);
    },
  };
}
