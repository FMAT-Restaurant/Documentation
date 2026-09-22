import { cp, mkdir, rm } from "node:fs/promises";

await rm("public", { recursive: true, force: true });
await mkdir("public", { recursive: true });
await cp("site/markdown", "public", { recursive: true });
await cp("eventcatalog/dist", "public/eventcatalog", { recursive: true });
await mkdir("public/contracts", { recursive: true });
await cp(
  "docs/contracts/FMAT-Restaurant-Events.yml",
  "public/contracts/FMAT-Restaurant-Events.yml",
);
