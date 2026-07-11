// Raw-string imports of markdown content files (see the `.md` webpack rule in
// next.config.mjs). Long-form page content lives in markdown; short UI strings
// stay in i18n.ts.
declare module '*.md' {
  const content: string;
  export default content;
}
