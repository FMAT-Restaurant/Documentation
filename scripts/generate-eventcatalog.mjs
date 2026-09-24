import path from "node:path";
import url from "node:url";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import YAML from "yaml";

const repositoryRoot = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const catalogDirectory = path.join(repositoryRoot, "eventcatalog");
const asyncApiPath = path.join(repositoryRoot, "docs", "contracts", "FMAT-Restaurant-Events.yml");
const domainEventsPath = path.join(repositoryRoot, "docs", "contracts", "domain-events.md");
const asyncApi = YAML.parse(await readFile(asyncApiPath, "utf8"));
const domainEventsMarkdown = await readFile(domainEventsPath, "utf8");
const domainEventsFrontmatter = domainEventsMarkdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
if (!domainEventsFrontmatter) throw new Error(`${domainEventsPath} no tiene frontmatter YAML válido`);
const domainEventsMetadata = YAML.parse(domainEventsFrontmatter[1]);
const domainEventCatalog = domainEventsMetadata.eventcatalog ?? {};
const catalogMetadata = asyncApi["x-eventcatalog"];
if (!catalogMetadata?.systems || !catalogMetadata?.services || !catalogMetadata?.operationServices) {
  throw new Error("AsyncAPI debe declarar x-eventcatalog con systems, services y operationServices");
}
const version = String(asyncApi.info.version);
const domainId = "fmat-restaurant";
const domainDirectory = path.join(catalogDirectory, "domains", domainId);
const internalSystem = Object.entries(catalogMetadata.systems).find(([, system]) => system.scope === "internal");
if (!internalSystem) throw new Error("AsyncAPI debe declarar el sistema interno en x-eventcatalog.systems");
const [internalSystemId] = internalSystem;
const systems = Object.entries(catalogMetadata.systems).map(([id, metadata]) => ({ id, ...metadata }));
const publicAsyncApiUrl = "https://fmat-restaurant.github.io/Documentation/contracts/FMAT-Restaurant-Events.yml";
const publicDomainEventsUrl = "https://fmat-restaurant.github.io/Documentation/contracts/domain-events/";

const services = Object.entries(catalogMetadata.services).map(([id, metadata]) => ({ id, ...metadata }));

const serviceById = new Map(services.map((service) => [service.id, service]));
const serviceForOperation = (operationId) => {
  const service = serviceById.get(catalogMetadata.operationServices[operationId]);
  if (!service) throw new Error(`No se pudo determinar el servicio de ${operationId}`);
  return service;
};

const slugify = (value) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

const refName = (ref) => ref?.split("/").at(-1);
const pointer = (id) => ({ id, version });
const astroReference = (collection, id) => ({ collection, id: `${id}-${version}` });

const resolvePointer = (value) => {
  if (!value?.$ref) return value;
  const segments = value.$ref.replace(/^#\//, "").split("/");
  return segments.reduce((current, segment) => current?.[segment], asyncApi);
};

const messageRefFromOperation = (operation) => {
  let current = operation.messages?.[0];
  let lastRef;
  while (current?.$ref) {
    lastRef = current.$ref;
    current = resolvePointer(current);
  }
  return refName(lastRef);
};

const operationMetadata = Object.entries(asyncApi.operations ?? {}).map(([id, operation]) => {
  const channelId = refName(operation.channel?.$ref);
  const channel = asyncApi.channels?.[channelId];
  const messageId = messageRefFromOperation(operation);
  const message = asyncApi.components?.messages?.[messageId];
  const service = serviceForOperation(id);
  if (!channel || !message || !messageId) {
    throw new Error(`La operación ${id} no referencia un canal o mensaje válido`);
  }
  return {
    id,
    action: operation.action,
    summary: operation.summary ?? "",
    description: operation.description ?? "",
    serviceId: service.id,
    channelId,
    messageId,
  };
});
for (const operationId of Object.keys(catalogMetadata.operationServices)) {
  if (!asyncApi.operations?.[operationId]) throw new Error(`x-eventcatalog.operationServices referencia una operación inexistente: ${operationId}`);
}
for (const service of services) {
  if (!operationMetadata.some((operation) => operation.serviceId === service.id)) {
    throw new Error(`El servicio ${service.id} no tiene operaciones AsyncAPI asignadas`);
  }
}

const messages = Object.entries(asyncApi.components?.messages ?? {}).map(([id, message]) => {
  const operations = operationMetadata.filter((operation) => operation.messageId === id);
  const producers = [...new Set(operations.filter((operation) => operation.action === "send").map((operation) => operation.serviceId))];
  const consumers = [...new Set(operations.filter((operation) => operation.action === "receive").map((operation) => operation.serviceId))];
  const type = message["x-eventcatalog-message-type"] ?? message.tags?.[0]?.name ?? "event";
  if (!operations.length || !producers.length || !consumers.length) {
    throw new Error(`El mensaje ${id} debe tener operaciones de publicación y consumo`);
  }
  return {
    id,
    name: message.name ?? id,
    title: message.title ?? message.name ?? id,
    summary: message.summary ?? "",
    contentType: message.contentType ?? asyncApi.defaultContentType,
    type,
    payload: message.payload,
    operations,
    producers,
    consumers,
    channelIds: [...new Set(operations.map((operation) => operation.channelId))],
  };
});

const channels = Object.entries(asyncApi.channels ?? {}).map(([id, channel]) => ({
  id,
  address: channel.address ?? id,
  description: channel.description ?? "",
  messageIds: Object.values(channel.messages ?? {}).map((message) => refName(message.$ref)),
}));

const channelById = new Map(channels.map((channel) => [channel.id, channel]));
const messageById = new Map(messages.map((message) => [message.id, message]));
const flows = domainEventCatalog.flows ?? [];

if (!Array.isArray(flows) || !flows.length) throw new Error("domain-events.md debe definir eventcatalog.flows en su frontmatter");
for (const flow of flows) {
  const steps = flow.steps ?? [];
  const stepIds = new Set(steps.map((step) => String(step.id)));
  if (!flow.id || !flow.name || !flow.summary || !steps.length || stepIds.size !== steps.length) {
    throw new Error(`El flujo ${flow.id ?? "(sin id)"} debe tener id, name, summary y pasos con ids únicos`);
  }
  for (const step of steps) {
    const nodeTypes = ["actor", "container", "custom", "dataProduct", "externalSystem", "flow", "message", "service"]
      .filter((key) => step[key] !== undefined);
    if (nodeTypes.length > 1) throw new Error(`El paso ${flow.id}/${step.id} combina tipos de nodo incompatibles`);
    if (step.service && !serviceById.has(step.service.id)) throw new Error(`El paso ${flow.id}/${step.id} referencia un servicio desconocido`);
    if (step.message && !messageById.has(step.message.id)) throw new Error(`El paso ${flow.id}/${step.id} referencia un mensaje desconocido`);
    const references = [step.next_step, ...(step.next_steps ?? [])].filter((reference) => reference !== undefined);
    for (const reference of references) {
      const target = typeof reference === "object" ? reference.id : reference;
      if (!stepIds.has(String(target))) throw new Error(`El paso ${flow.id}/${step.id} apunta al paso inexistente ${target}`);
    }
  }
}

const flowById = new Map(flows.map((flow) => [flow.id, flow]));
const flowRefsForService = (serviceId) => flows
  .filter((flow) => flow.steps.some((step) => {
    if (step.service?.id === serviceId) return true;
    const message = step.message ? messageById.get(step.message.id) : undefined;
    return message?.producers.includes(serviceId) || message?.consumers.includes(serviceId);
  }))
  .map((flow) => pointer(flow.id));

const dereference = (schema, stack = new Set()) => {
  if (!schema || typeof schema !== "object") return schema;
  if (schema.$ref) {
    if (stack.has(schema.$ref)) return {};
    const nextStack = new Set(stack).add(schema.$ref);
    return dereference(resolvePointer(schema), nextStack);
  }
  if (Array.isArray(schema)) return schema.map((item) => dereference(item, stack));
  return Object.fromEntries(Object.entries(schema).map(([key, value]) => [key, dereference(value, stack)]));
};

const schemaType = (schema) => {
  if (!schema || typeof schema !== "object") return "—";
  if (schema.const !== undefined) return `const ${JSON.stringify(schema.const)}`;
  if (Array.isArray(schema.type)) return schema.type.join(" | ");
  if (schema.type === "array") return `array of ${schemaType(schema.items)}`;
  return schema.type ?? (schema.properties || schema.allOf ? "object" : "—");
};

const collectDataSchemas = (schema, results = []) => {
  if (!schema || typeof schema !== "object") return results;
  if (schema.properties?.data) results.push(schema.properties.data);
  for (const child of schema.allOf ?? []) collectDataSchemas(child, results);
  return results;
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

const markdownCell = (value) => String(value ?? "—").replaceAll("|", "\\|").replaceAll("\n", " ");
const fieldsTable = (schema) => {
  const rows = collectFields({ allOf: collectDataSchemas(schema) });
  if (!rows.size) return "| Campo | Tipo | Requerido | Descripción |\n| --- | --- | --- | --- |\n| `data` | object | Sí | Payload de negocio del mensaje. |";
  return [
    "| Campo | Tipo | Requerido | Descripción |",
    "| --- | --- | --- | --- |",
    ...rows.values().map((field) => `| \`${field.path}\` | ${markdownCell(field.type)} | ${field.required ? "Sí" : "No"} | ${markdownCell(field.description)} |`),
  ].join("\n");
};

const cloudEventType = (schema) => {
  if (!schema || typeof schema !== "object") return "—";
  if (schema.properties?.type?.const) return schema.properties.type.const;
  for (const child of schema.allOf ?? []) {
    const result = cloudEventType(child);
    if (result !== "—") return result;
  }
  return "—";
};

const frontmatter = (data) => `---\n${YAML.stringify(data).trimEnd()}\n---\n`;
const resourceLink = (type, id, label) => `<ResourceLink id="${id}" type="${type}">${label}</ResourceLink>`;
const writeResource = async (directory, metadata, body) => {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "index.mdx"), `${frontmatter(metadata)}\n${body.trim()}\n`, "utf8");
};

const serviceMessageRows = (service) => messages
  .filter((message) => message.producers.includes(service.id) || message.consumers.includes(service.id))
  .sort((left, right) => left.name.localeCompare(right.name))
  .map((message) => {
    const role = message.producers.includes(service.id) && message.consumers.includes(service.id)
      ? "Productor y consumidor"
      : message.producers.includes(service.id) ? "Productor" : "Consumidor";
    const messageType = message.type === "command" ? "command" : "event";
    return `| ${resourceLink(messageType, message.id, message.name)} | ${role} | ${message.channelIds.map((id) => `\`${channelById.get(id).address}\``).join(", ")} |`;
  });

const buildServiceSpec = (service) => {
  const serviceOperations = operationMetadata.filter((operation) => operation.serviceId === service.id);
  const selectedChannels = Object.fromEntries(serviceOperations.map((operation) => [operation.channelId, asyncApi.channels[operation.channelId]]));
  return {
    ...asyncApi,
    info: { ...asyncApi.info, title: `${asyncApi.info.title} - ${service.name}` },
    "x-eventcatalog": {
      ...catalogMetadata,
      services: { [service.id]: catalogMetadata.services[service.id] },
      operationServices: Object.fromEntries(serviceOperations.map((operation) => [operation.id, service.id])),
    },
    channels: selectedChannels,
    operations: Object.fromEntries(serviceOperations.map((operation) => [operation.id, asyncApi.operations[operation.id]])),
  };
};

const writeDomain = async () => {
  await writeFile(path.join(domainDirectory, "asyncapi.yml"), YAML.stringify(asyncApi), "utf8");
  await writeResource(domainDirectory, {
    id: domainId,
    name: "FMAT Restaurant",
    version,
    summary: "Contratos y mensajes operacionales del restaurante.",
    systems: systems.map((system) => pointer(system.id)),
    services: services.map((service) => pointer(service.id)),
    flows: flows.map((flow) => pointer(flow.id)),
  }, [
    "## Modelo del dominio",
    "",
    "Este dominio agrupa el sistema interno de operación y la integración externa de pagos. EventCatalog conecta los cuatro servicios, sus mensajes y canales, y los flujos del documento fuente.",
    "",
    "## Sistemas",
    "",
    "| Sistema | Alcance |",
    "| --- | --- |",
    ...systems.map((system) => `| ${resourceLink("system", system.id, system.name)} | ${system.scope === "external" ? "Externo" : "Interno"} |`),
    "",
    "## Contrato AsyncAPI canónico",
    "",
    `El contrato completo está disponible en [FMAT-Restaurant-Events.yml](${publicAsyncApiUrl}). Cada servicio también muestra su especificación AsyncAPI filtrada.`,
    "",
    "## Flujos",
    "",
    "| Flujo | Propósito |",
    "| --- | --- |",
    ...flows.map((flow) => `| ${resourceLink("flow", flow.id, flow.name)} | ${flow.summary} |`),
    "",
    `Los pasos estructurados y los diagramas Mermaid se mantienen en [domain-events.md](${publicDomainEventsUrl}). Las decisiones abiertas del contrato conservan ese estado explícito.`,
  ].join("\n"));
};

const writeServices = async () => {
  for (const service of services) {
    const serviceDirectory = path.join(domainDirectory, "systems", internalSystemId, "services", service.id);
    await mkdir(serviceDirectory, { recursive: true });
    const sends = messages.filter((message) => message.producers.includes(service.id)).map((message) => ({
      id: message.id,
      version,
      to: message.channelIds.map((channelId) => ({ id: slugify(channelId), version, delivery_mode: "push" })),
    }));
    const receives = messages.filter((message) => message.consumers.includes(service.id)).map((message) => ({
      id: message.id,
      version,
      from: message.channelIds.map((channelId) => ({ id: slugify(channelId), version, delivery_mode: "push" })),
    }));
    await writeFile(path.join(serviceDirectory, "asyncapi.yml"), YAML.stringify(buildServiceSpec(service)), "utf8");
    await writeResource(serviceDirectory, {
      id: service.id,
      name: service.name,
      version,
      summary: service.summary,
      specifications: [{ type: "asyncapi", path: "asyncapi.yml", name: "AsyncAPI" }],
      sends,
      receives,
      flows: flowRefsForService(service.id),
    }, [
      "## Responsabilidad",
      "",
      service.summary,
      "",
      "## Arquitectura de mensajes",
      "",
      "<MessageTable format=\"all\" />",
      "",
      "## Mensajes relacionados",
      "",
      "| Mensaje | Papel | Canal |",
      "| --- | --- | --- |",
      ...serviceMessageRows(service),
      "",
      "## Flujos que participa",
      "",
      ...flowRefsForService(service.id).map((flow) => `- [[flow|${flow.id}]] — ${flowById.get(flow.id).name}`),
      "",
      "La especificación AsyncAPI enlazada a este servicio conserva únicamente sus operaciones y los componentes necesarios para resolverlas.",
    ].join("\n"));
  }
};

const writeSystems = async () => {
  for (const system of systems) {
    const isInternal = system.id === internalSystemId;
    const systemDirectory = isInternal
      ? path.join(domainDirectory, "systems", system.id)
      : path.join(catalogDirectory, "systems", system.id);
    if (!isInternal) await rm(systemDirectory, { recursive: true, force: true });
    const metadata = {
      id: system.id,
      name: system.name,
      version,
      summary: system.summary,
      scope: system.scope,
    };

    if (isInternal) {
      Object.assign(metadata, {
        services: services.map((service) => pointer(service.id)),
        flows: flows.map((flow) => pointer(flow.id)),
        relationships: system.relationships ?? [],
        actors: domainEventCatalog.actors ?? [],
      });
      await writeResource(systemDirectory, metadata, [
        "## Contexto del sistema",
        "",
        "<ContextDiagram />",
        "",
        "## Recursos",
        "",
        "<NodeGraph />",
        "",
        "## Servicios",
        "",
        "| Servicio | Responsabilidad |",
        "| --- | --- |",
        ...services.map((service) => `| ${resourceLink("service", service.id, service.name)} | ${service.summary} |`),
        "",
        "## Flujos de negocio",
        "",
        ...flows.map((flow) => `- [[flow|${flow.id}]] — ${flow.name}`),
      ].join("\n"));
      continue;
    }

    await writeResource(systemDirectory, metadata, [
      "## Alcance",
      "",
      system.summary,
      "",
      `Este sistema está relacionado con [[system|${internalSystemId}]]. El contrato no identifica un proveedor concreto ni especifica su protocolo o mensajes de respuesta.`,
    ].join("\n"));
  }
};

const writeMessages = async () => {
  for (const message of messages) {
    const collection = message.type === "command" ? "commands" : "events";
    const messageDirectory = path.join(domainDirectory, collection, slugify(message.id));
    await mkdir(messageDirectory, { recursive: true });
    const schema = dereference(message.payload);
    await writeFile(path.join(messageDirectory, "schema.json"), `${JSON.stringify(schema, null, 2)}\n`, "utf8");
    await writeResource(messageDirectory, {
      id: message.id,
      name: message.name,
      version,
      summary: message.summary,
      schemaPath: "schema.json",
      producers: message.producers.map((serviceId) => astroReference("services", serviceId)),
      consumers: message.consumers.map((serviceId) => astroReference("services", serviceId)),
      channels: message.channelIds.map((channelId) => ({ id: slugify(channelId), version })),
    }, [
      `## ${message.type === "command" ? "Comando" : "Evento"}`,
      "",
      message.summary,
      "",
      "| Propiedad | Valor |",
      "| --- | --- |",
      `| Tipo de mensaje | \`${message.type}\` |`,
      `| Tipo CloudEvent | \`${cloudEventType(schema)}\` |`,
      `| Content-Type | \`${message.contentType}\` |`,
      `| Productor | ${message.producers.map((id) => serviceById.get(id).name).join(", ")} |`,
      `| Consumidor | ${message.consumers.map((id) => serviceById.get(id).name).join(", ")} |`,
      `| Canal | ${message.channelIds.map((id) => `\`${channelById.get(id).address}\``).join(", ")} |`,
      "",
      "## Relaciones",
      "",
      `- Productor: ${message.producers.map((id) => `[[service|${id}]]`).join(", ")}`,
      `- Consumidor: ${message.consumers.map((id) => `[[service|${id}]]`).join(", ")}`,
      `- Canal: ${message.channelIds.map((id) => `[[channel|${slugify(id)}]]`).join(", ")}`,
      "",
      "## Payload de negocio",
      "",
      "El mensaje usa un sobre CloudEvents 1.0 y coloca el payload de negocio en `data`.",
      "",
      fieldsTable(schema),
      "",
      "## Esquema JSON",
      "",
      "El esquema está adjunto a este mensaje para inspeccionarlo y reutilizarlo desde EventCatalog.",
      "",
      "<SchemaViewer file=\"schema.json\" title=\"Esquema JSON del mensaje\" maxHeight=\"600\" expand=\"true\" />",
      "",
      "## Operaciones AsyncAPI",
      "",
      "| Operación | Acción | Servicio |",
      "| --- | --- | --- |",
      ...message.operations.map((operation) => `| \`${operation.id}\` | \`${operation.action}\` | ${serviceById.get(operation.serviceId).name} |`),
    ].join("\n"));
  }
};

const writeChannels = async () => {
  for (const channel of channels) {
    const channelDirectory = path.join(domainDirectory, "channels", slugify(channel.id));
    const channelMessages = channel.messageIds.map((id) => messageById.get(id)).filter(Boolean);
    await writeResource(channelDirectory, {
      id: slugify(channel.id),
      name: channel.id,
      version,
      summary: channel.description,
      address: channel.address,
    }, [
      "## Contrato del canal",
      "",
      channel.description,
      "",
      "<ChannelInformation />",
      "",
      "| Propiedad | Valor |",
      "| --- | --- |",
      `| Address | \`${channel.address}\` |`,
      "| Protocolo | Por definir |",
      "| Garantía de entrega | Por definir |",
      "",
      "## Mensajes",
      "",
      "| Mensaje | Tipo |",
      "| --- | --- |",
      ...channelMessages.map((message) => `| ${resourceLink(message.type === "command" ? "command" : "event", message.id, message.name)} | ${message.type} |`),
      "",
      "El address y el transporte se conservan como propuesta porque el contrato fuente todavía no fija broker, protocolo, tópicos ni garantías de entrega.",
    ].join("\n"));
  }
};

const writeFlows = async () => {
  for (const flow of flows) {
    await writeResource(path.join(domainDirectory, "systems", internalSystemId, "flows", flow.id), {
      id: flow.id,
      name: flow.name,
      version,
      summary: flow.summary,
      steps: flow.steps,
    }, [
      "## Propósito",
      "",
      flow.summary,
      "",
      "## Diagrama del flujo",
      "",
      "<NodeGraph />",
      "",
      `Los pasos se mantienen en [domain-events.md](${publicDomainEventsUrl}). Los resultados síncronos o internos sin mensaje AsyncAPI se muestran como pasos locales, no como eventos inventados.`,
    ].join("\n"));
  }
};

await rm(domainDirectory, { recursive: true, force: true });
await rm(path.join(catalogDirectory, "domains", "FMAT Restaurant"), { recursive: true, force: true });
await mkdir(domainDirectory, { recursive: true });
await writeDomain();
await writeServices();
await writeSystems();
await writeMessages();
await writeChannels();
await writeFlows();

console.log(`EventCatalog generado: 1 dominio, ${services.length} servicios, ${messages.filter((message) => message.type === "command").length} comandos, ${messages.filter((message) => message.type === "event").length} eventos, ${channels.length} canales y ${flows.length} flujos.`);
console.log(`Contrato canónico: ${publicAsyncApiUrl}`);
