/** @type {import('@eventcatalog/core/bin/eventcatalog.config').Config} */
export default {
  cId: "fmat-restaurant-contracts",
  title: "FMAT Restaurant",
  tagline: "Catálogo navegable de contratos y eventos operacionales.",
  organizationName: "FMAT Restaurant",
  homepageLink: "https://eventcatalog.dev",
  port: 3000,
  outDir: "dist",
  base: process.env.EVENTCATALOG_BASE ?? "/eventcatalog/",
  trailingSlash: false,
  theme: "sapphire",
  docs: {
    sidebar: {
      showPageHeadings: true,
    },
  },
  output: "static",
};
