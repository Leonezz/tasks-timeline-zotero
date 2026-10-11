// esbuild loads .css as text (see zotero-plugin.config.ts) for Shadow DOM injection.
declare module "*.css" {
  const content: string;
  export default content;
}
