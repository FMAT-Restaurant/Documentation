import path from "node:path";
import url from "node:url";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import pluginModule from "@eventcatalog/plugin-doc-generator-asyncapi";

const repositoryRoot = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const asyncApiGenerator = pluginModule.default ?? pluginModule;
const catalogDirectory = path.join(repositoryRoot, "eventcatalog");
const generatedDomainDirectory = path.join(catalogDirectory, "domains", "FMAT Restaurant");
process.env.PROJECT_DIR = catalogDirectory;

await rm(generatedDomainDirectory, { recursive: true, force: true });

await asyncApiGenerator(
  {},
  {
    pathToSpec: [path.join(repositoryRoot, "docs", "contracts", "FMAT-Restaurant-Events.yml")],
    domainName: "FMAT Restaurant",
    domainSummary: "Contratos y mensajes operacionales del restaurante.",
    externalAsyncAPIUrl: "../contracts/FMAT-Restaurant-Events.yml",
  },
);

const slugify = (value) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

const normalizeFrontmatter = async (filePath) => {
  const relativePath = path.relative(generatedDomainDirectory, filePath);
  const resourceName = path.basename(path.dirname(filePath));
  const resourceType = relativePath === "index.md" ? "domain" : relativePath.split(path.sep)[0];
  const resourceId = resourceType === "domain" ? "fmat-restaurant" : slugify(resourceName);
  const content = await readFile(filePath, "utf8");
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);

  if (!match) {
    return;
  }

  const frontmatter = match[1]
    .replace(/^externalLinks:\r?\n(?:\s+-.*(?:\r?\n|$))?/m, "")
    .replace(
      /^(producers|consumers):\r?\n\s+- 'FMAT Restaurant - Eventos operacionales'\r?\n?/gm,
      "$1:\n    - fmat-restaurant-eventos-operacionales-0.1.0\n",
    );
  const additions = [];
  if (!/^id:/m.test(frontmatter)) {
    additions.push(`id: ${resourceId}`);
  }
  if (!/^version:/m.test(frontmatter)) {
    additions.push("version: 0.1.0");
  }

  if (additions.length > 0 || frontmatter !== match[1]) {
    await writeFile(filePath, `---\n${additions.join("\n")}\n${frontmatter}\n---\n${match[2]}`, "utf8");
  }
};

const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(entryPath);
    } else if (entry.name === "index.md") {
      await normalizeFrontmatter(entryPath);
    }
  }
};

await walk(generatedDomainDirectory);
