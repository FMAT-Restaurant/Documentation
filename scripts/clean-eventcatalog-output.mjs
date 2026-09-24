import path from "node:path";
import url from "node:url";
import { rm } from "node:fs/promises";

const repositoryRoot = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const outputDirectory = path.join(repositoryRoot, "eventcatalog", "dist");

await rm(outputDirectory, { recursive: true, force: true });
console.log("Compilación estática previa de EventCatalog eliminada.");
