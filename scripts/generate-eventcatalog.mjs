import path from "node:path";
import url from "node:url";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import YAML from "yaml";
import pluginModule from "@eventcatalog/plugin-doc-generator-asyncapi";

const repositoryRoot = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const asyncApiPath = path.join(repositoryRoot, "docs", "contracts", "FMAT-Restaurant-Events.yml");
const asyncApiGenerator = pluginModule.default ?? pluginModule;
const catalogDirectory = path.join(repositoryRoot, "eventcatalog");
const generatedDomainDirectory = path.join(catalogDirectory, "domains", "FMAT Restaurant");
const asyncApi = YAML.parse(await readFile(asyncApiPath, "utf8"));
const version = "0.1.0";

process.env.PROJECT_DIR = catalogDirectory;

const services = [
  {
    id: "orders-kitchen",
    name: "Orders & Kitchen",
    source: "urn:fmat:service:orders-kitchen",
    summary: "Gestiona las órdenes, la preparación y los eventos que habilitan el flujo operativo.",
  },
  {
    id: "inventory",
    name: "Inventory",
    source: "urn:fmat:service:inventory",
    summary: "Administra reservas, ajustes, consumo y liberación de inventario.",
  },
  {
    id: "sala",
    name: "Sala",
    source: "urn:fmat:service:sala",
    summary: "Coordina el servicio en mesa y comunica cuándo una orden fue servida.",
  },
  {
    id: "billing-payments",
    name: "Billing & Payments",
    source: "urn:fmat:service:billing-payments",
    summary: "Gestiona cuentas, cobros, cierres y reembolsos.",
  },
];

const serviceById = new Map(services.map((service) => [service.id, service]));
const serviceByOperationPrefix = [
  ["ordersKitchen", "orders-kitchen"],
  ["inventory", "inventory"],
  ["sala", "sala"],
  ["billingPayments", "billing-payments"],
];

const slugify = (value) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

const quoteYaml = (value) => `'${String(value).replaceAll("'", "''")}'`;
const resourceId = (id) => `${id}-${version}`;

const serviceForOperation = (operationId) => {
  const match = serviceByOperationPrefix.find(([prefix]) => operationId.startsWith(prefix));
  if (!match) {
    throw new Error(`No se pudo determinar el servicio de la operación AsyncAPI ${operationId}`);
  }
  return serviceById.get(match[1]);
};

const refName = (ref) => ref?.split("/").at(-1);

const eventMetadata = new Map();
for (const [operationId, operation] of Object.entries(asyncApi.operations ?? {})) {
  const channelId = refName(operation.channel?.$ref);
  const channel = asyncApi.channels?.[channelId];
  const operationMessageId = refName(operation.messages?.[0]?.$ref);
  const componentMessageId = refName(channel?.messages?.[operationMessageId]?.$ref) ?? operationMessageId;
  const message = asyncApi.components?.messages?.[componentMessageId];

  if (!channelId || !operationMessageId || !message || !channel) {
    throw new Error(`La operación ${operationId} no referencia un canal o mensaje válido`);
  }

  const name = message.name ?? componentMessageId;
  const current = eventMetadata.get(name) ?? {
    name,
    summary: message.summary ?? "",
    contentType: message.contentType ?? "application/cloudevents+json",
    channel: channel.address ?? channelId,
    producers: new Set(),
    consumers: new Set(),
  };
  const service = serviceForOperation(operationId);
  if (operation.action === "send") current.producers.add(service.id);
  if (operation.action === "receive") current.consumers.add(service.id);
  eventMetadata.set(name, current);
}

for (const event of eventMetadata.values()) {
  if (event.producers.size === 0 || event.consumers.size === 0) {
    throw new Error(`El evento ${event.name} debe tener productor y consumidor en AsyncAPI`);
  }
}

await rm(generatedDomainDirectory, { recursive: true, force: true });

await asyncApiGenerator(
  {},
  {
    pathToSpec: [asyncApiPath],
    domainName: "FMAT Restaurant",
    domainSummary: "Contratos y mensajes operacionales del restaurante.",
    externalAsyncAPIUrl: "../contracts/FMAT-Restaurant-Events.yml",
  },
);

await rm(
  path.join(generatedDomainDirectory, "services", "FMAT Restaurant - Eventos operacionales"),
  { recursive: true, force: true },
);

const findDataSchemas = (schema, results = []) => {
  if (!schema || typeof schema !== "object") return results;
  if (schema.properties?.data) results.push(schema.properties.data);
  for (const child of schema.allOf ?? []) findDataSchemas(child, results);
  return results;
};

const schemaType = (schema) => {
  if (!schema || typeof schema !== "object") return "—";
  if (schema.const !== undefined) return `const ${JSON.stringify(schema.const)}`;
  if (Array.isArray(schema.type)) return schema.type.join(" | ");
  if (schema.type === "array") return `array<${schemaType(schema.items)}>`;
  return schema.type ?? (schema.properties || schema.allOf ? "object" : "—");
};

const collectFields = (schema, prefix = "data", rows = new Map()) => {
  if (!schema || typeof schema !== "object") return rows;
  for (const child of schema.allOf ?? []) collectFields(child, prefix, rows);
  const required = new Set(schema.required ?? []);
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    const fieldPath = `${prefix}.${name}`;
    const previous = rows.get(fieldPath);
    rows.set(fieldPath, {
      path: fieldPath,
      type: schemaType(property),
      required: previous?.required || required.has(name),
      description: property.description ?? previous?.description ?? "",
    });
    if (property.properties || property.allOf) collectFields(property, fieldPath, rows);
  }
  return rows;
};

const markdownTableCell = (value) => String(value).replaceAll("|", "\\|").replaceAll("\n", " ");

const fieldsTable = (schema) => {
  const dataSchemas = findDataSchemas(schema);
  const rows = collectFields({ allOf: dataSchemas });
  if (rows.size === 0) {
    return "| Campo | Tipo | Requerido | Descripción |\n| --- | --- | --- | --- |\n| `data` | object | Sí | Payload de negocio del evento. |";
  }
  return [
    "| Campo | Tipo | Requerido | Descripción |",
    "| --- | --- | --- | --- |",
    ...rows.values().map(
      (field) =>
        `| \`${field.path}\` | ${markdownTableCell(field.type)} | ${field.required ? "Sí" : "No"} | ${markdownTableCell(field.description || "—")} |`,
    ),
  ].join("\n");
};

const findCloudEventType = (schema) => {
  if (!schema || typeof schema !== "object") return "—";
  if (schema.properties?.type?.const) return schema.properties.type.const;
  for (const child of schema.allOf ?? []) {
    const result = findCloudEventType(child);
    if (result !== "—") return result;
  }
  return "—";
};

const normalizeSchema = async (schemaPath) => {
  const wrapper = JSON.parse(await readFile(schemaPath, "utf8"));
  const schema = wrapper._schemaObject ?? wrapper._json ?? wrapper;
  await writeFile(schemaPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
  return schema;
};

const writeServicePage = async (service) => {
  const serviceDirectory = path.join(generatedDomainDirectory, "services", service.name);
  await mkdir(serviceDirectory, { recursive: true });
  const relatedEvents = [...eventMetadata.values()]
    .filter((event) => event.producers.has(service.id) || event.consumers.has(service.id))
    .sort((left, right) => left.name.localeCompare(right.name));
  const rows = relatedEvents.map((event) => {
    const role = event.producers.has(service.id) && event.consumers.has(service.id)
      ? "Productor y consumidor"
      : event.producers.has(service.id)
        ? "Productor"
        : "Consumidor";
    const eventPath = `../../../events/${slugify(event.name)}/${version}`;
    return `| [${event.name}](${eventPath}) | ${role} | \`${event.channel}\` |`;
  });
  const body = [
    "## Responsabilidad",
    "",
    service.summary,
    "",
    "## Mensajes relacionados",
    "",
    "| Mensaje | Papel | Canal |",
    "| --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
  const frontmatter = [
    "---",
    `id: ${service.id}`,
    `version: ${version}`,
    `name: ${quoteYaml(service.name)}`,
    `summary: ${quoteYaml(service.summary)}`,
    "---",
    "",
  ].join("\n");
  await writeFile(path.join(serviceDirectory, "index.md"), `${frontmatter}${body}`, "utf8");
};

const writeDomainPage = async () => {
  const serviceRows = services.map(
    (service) => `| ${service.name} | \`${service.source}\` | ${service.summary} |`,
  );
  const body = [
    "## Servicios del dominio",
    "",
    "| Servicio | Fuente CloudEvents | Responsabilidad |",
    "| --- | --- | --- |",
    ...serviceRows,
    "",
    "## Cómo leer el catálogo",
    "",
    "Cada mensaje muestra su productor, consumidor, canal y los campos del payload de negocio dentro del sobre CloudEvents.",
    "",
  ].join("\n");
  const frontmatter = [
    "---",
    "id: fmat-restaurant",
    `version: ${version}`,
    "name: 'FMAT Restaurant'",
    "summary: 'Contratos y mensajes operacionales del restaurante.'",
    "---",
    "",
  ].join("\n");
  await writeFile(path.join(generatedDomainDirectory, "index.md"), `${frontmatter}${body}`, "utf8");
};

const eventsDirectory = path.join(generatedDomainDirectory, "events");
for (const event of eventMetadata.values()) {
  const eventDirectory = path.join(eventsDirectory, event.name);
  const schemaPath = path.join(eventDirectory, "schema.json");
  const schema = await normalizeSchema(schemaPath);
  const producerRows = [...event.producers].map((id) => serviceById.get(id).name).join(", ");
  const consumerRows = [...event.consumers].map((id) => serviceById.get(id).name).join(", ");
  const frontmatter = [
    "---",
    `id: ${slugify(event.name)}`,
    `name: ${event.name}`,
    `summary: ${quoteYaml(event.summary)}`,
    `version: ${version}`,
    "producers:",
    ...[...event.producers].map((id) => `    - ${resourceId(id)}`),
    "consumers:",
    ...[...event.consumers].map((id) => `    - ${resourceId(id)}`),
    "badges: []",
    "---",
    "",
  ].join("\n");
  const body = [
    "## Contrato del mensaje",
    "",
    event.summary,
    "",
    "| Propiedad | Valor |",
    "| --- | --- |",
    `| Tipo CloudEvent | \`${findCloudEventType(schema)}\` |`,
    `| Productor | ${producerRows} |`,
    `| Consumidor | ${consumerRows} |`,
    `| Canal | \`${event.channel}\` |`,
    `| Content-Type | \`${event.contentType}\` |`,
    "",
    "## Datos del payload",
    "",
    "El mensaje usa un sobre CloudEvents 1.0 y coloca el payload de negocio en `data`.",
    "",
    fieldsTable(schema),
    "",
    "El archivo `schema.json` de cada evento conserva el esquema JSON normalizado para herramientas; esta tabla presenta sus campos de negocio de forma legible.",
    "",
  ].join("\n");
  await writeFile(path.join(eventDirectory, "index.md"), `${frontmatter}${body}`, "utf8");
}

await writeDomainPage();
for (const service of services) await writeServicePage(service);
