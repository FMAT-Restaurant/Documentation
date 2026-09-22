import path from "node:path";
import url from "node:url";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import YAML from "yaml";

const repositoryRoot = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const catalogDirectory = path.join(repositoryRoot, "eventcatalog");
const asyncApiPath = path.join(repositoryRoot, "docs", "contracts", "FMAT-Restaurant-Events.yml");
const asyncApi = YAML.parse(await readFile(asyncApiPath, "utf8"));
const version = String(asyncApi.info.version);
const domainId = "fmat-restaurant";
const domainDirectory = path.join(catalogDirectory, "domains", domainId);
const publicAsyncApiUrl = "https://fmat-restaurant.github.io/Documentation/contracts/FMAT-Restaurant-Events.yml";
const publicDomainEventsUrl = "https://fmat-restaurant.github.io/Documentation/contracts/domain-events/";

const services = [
  {
    id: "orders-kitchen",
    name: "Orders & Kitchen",
    source: "urn:fmat:service:orders-kitchen",
    summary: "Gestiona las órdenes, la preparación y los eventos que habilitan el flujo operativo.",
    operationPrefix: "ordersKitchen",
  },
  {
    id: "inventory",
    name: "Inventory",
    source: "urn:fmat:service:inventory",
    summary: "Administra reservas, ajustes, consumo y liberación de inventario.",
    operationPrefix: "inventory",
  },
  {
    id: "sala",
    name: "Sala",
    source: "urn:fmat:service:sala",
    summary: "Coordina el servicio en mesa y comunica cuándo una orden fue servida.",
    operationPrefix: "sala",
  },
  {
    id: "billing-payments",
    name: "Billing & Payments",
    source: "urn:fmat:service:billing-payments",
    summary: "Gestiona cuentas, cobros, cierres y reembolsos.",
    operationPrefix: "billingPayments",
  },
];

const serviceById = new Map(services.map((service) => [service.id, service]));
const serviceForOperation = (operationId) => {
  const service = services.find((candidate) => operationId.startsWith(candidate.operationPrefix));
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
const resourcePath = (collection, id) => `./${collection}/${slugify(id)}/${version}`;

const resolvePointer = (value) => {
  if (!value?.$ref) return value;
  const segments = value.$ref.replace(/^#\//, "").split("/");
  return segments.reduce((current, segment) => current?.[segment], asyncApi);
};

const resolveDeep = (value, stack = new Set()) => {
  if (!value || typeof value !== "object") return value;
  if (value.$ref) {
    if (stack.has(value.$ref)) return {};
    const nextStack = new Set(stack).add(value.$ref);
    return resolveDeep(resolvePointer(value), nextStack);
  }
  if (Array.isArray(value)) return value.map((item) => resolveDeep(item, stack));
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolveDeep(child, stack)]));
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

const flows = [
  {
    id: "order-fulfillment",
    name: "Creación de orden hasta finalización",
    summary: "Recorrido principal desde la creación de una orden hasta su servicio y cierre de cuenta.",
    steps: [
      { id: "start", title: "El cliente solicita una orden", actor: { name: "Cliente" }, next_step: "reserve" },
      { id: "reserve", title: "Orders & Kitchen solicita la reserva inicial", message: pointer("InventoryReservationRequested"), next_step: "confirmed" },
      { id: "confirmed", title: "Inventory confirma la reserva", message: pointer("InventoryReservationConfirmed"), next_step: "prepare" },
      { id: "prepare", title: "Orders & Kitchen inicia la preparación", message: pointer("PreparationStarted"), next_step: "ready" },
      { id: "ready", title: "Orders & Kitchen informa que la orden está lista", message: pointer("OrderReady"), next_step: "served" },
      { id: "served", title: "Sala informa que la orden fue servida", message: pointer("OrderServed"), next_step: "closed" },
      { id: "closed", title: "Billing & Payments cierra la cuenta", message: pointer("AccountClosed") },
    ],
  },
  {
    id: "order-creation-failure",
    name: "Fallo durante la creación de la orden",
    summary: "Flujo compensatorio cuando la reserva inicial no puede realizarse.",
    steps: [
      { id: "start", title: "El cliente solicita una orden", actor: { name: "Cliente" }, next_step: "request" },
      { id: "request", title: "Orders & Kitchen solicita la reserva", message: pointer("InventoryReservationRequested"), next_steps: [{ id: "confirmed" }, { id: "rejected" }] },
      { id: "confirmed", title: "Inventory confirma la reserva", message: pointer("InventoryReservationConfirmed") },
      { id: "rejected", title: "Inventory rechaza la reserva", message: pointer("InventoryReservationRejected"), next_step: "cancelled" },
      { id: "cancelled", title: "Orders & Kitchen cancela la orden", message: pointer("OrderCancelled") },
    ],
  },
  {
    id: "order-update",
    name: "Actualización de orden con impacto en inventario",
    summary: "Flujo de ajuste de reserva y decisión sobre la versión propuesta de una orden.",
    steps: [
      { id: "change", title: "El cliente solicita cambiar la orden", actor: { name: "Cliente" }, next_step: "request" },
      { id: "request", title: "Orders & Kitchen solicita ajustar la reserva", message: pointer("InventoryReservationAdjustmentRequested"), next_steps: [{ id: "adjusted" }, { id: "rejected" }] },
      { id: "adjusted", title: "Inventory confirma el ajuste", message: pointer("InventoryReservationAdjusted") },
      { id: "rejected", title: "Inventory rechaza el ajuste", message: pointer("InventoryReservationRejected") },
    ],
  },
  {
    id: "payment-and-account-closure",
    name: "Pago y cierre de cuenta",
    summary: "Flujo posterior al servicio de la orden para registrar el pago y cerrar la cuenta.",
    steps: [
      { id: "served", title: "Sala informa que la orden fue servida", message: pointer("OrderServed"), next_step: "payment" },
      { id: "payment", title: "Billing & Payments procesa el cobro", externalSystem: { name: "Proveedor de pagos", summary: "Sistema externo que autoriza el pago." }, next_steps: [{ id: "closed" }, { id: "pending" }] },
      { id: "closed", title: "Billing & Payments publica el cierre de cuenta", message: pointer("AccountClosed") },
      { id: "pending", title: "El cierre queda pendiente de resolución", custom: { title: "Pago pendiente o rechazado", type: "decision", summary: "El contrato de eventos no fija el evento de rechazo del pago." } },
    ],
  },
  {
    id: "payment-refund",
    name: "Reembolso de pago",
    summary: "Flujo de notificación de un reembolso confirmado por el proveedor de pagos.",
    steps: [
      { id: "request", title: "Se solicita un reembolso", actor: { name: "Operador o cliente" }, next_step: "provider" },
      { id: "provider", title: "El proveedor confirma el reembolso", externalSystem: { name: "Proveedor de pagos", summary: "Sistema externo que confirma la devolución." }, next_steps: [{ id: "refunded" }, { id: "rejected" }] },
      { id: "refunded", title: "Billing & Payments publica el reembolso", message: pointer("PaymentRefunded") },
      { id: "rejected", title: "El reembolso no queda confirmado", custom: { title: "Reembolso rechazado o pendiente", type: "decision", summary: "El contrato de eventos solo documenta el reembolso confirmado." } },
    ],
  },
];

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
    return `| [${message.name}](${resourcePath(message.type === "command" ? "commands" : "events", message.id)}) | ${role} | ${message.channelIds.map((id) => `\`${channelById.get(id).address}\``).join(", ")} |`;
  });

const buildServiceSpec = (service) => {
  const serviceOperations = operationMetadata.filter((operation) => operation.serviceId === service.id);
  const selectedChannels = Object.fromEntries(serviceOperations.map((operation) => [operation.channelId, asyncApi.channels[operation.channelId]]));
  return {
    ...asyncApi,
    info: { ...asyncApi.info, title: `${asyncApi.info.title} - ${service.name}` },
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
    services: services.map((service) => pointer(service.id)),
    flows: flows.map((flow) => pointer(flow.id)),
  }, [
    "## Modelo del dominio",
    "",
    "Este dominio organiza el contrato operativo en servicios, mensajes, canales y flujos navegables. La especificación AsyncAPI completa se conserva como `asyncapi.yml` y es la fuente técnica de los recursos generados.",
    "",
    "## Servicios",
    "",
    "| Servicio | Responsabilidad |",
    "| --- | --- |",
    ...services.map((service) => `| [${service.name}](${resourcePath("services", service.id)}) | ${service.summary} |`),
    "",
    "## Flujos",
    "",
    "| Flujo | Propósito |",
    "| --- | --- |",
    ...flows.map((flow) => `| [${flow.name}](${resourcePath("flows", flow.id)}) | ${flow.summary} |`),
    "",
    `La semántica de los recorridos se deriva de [domain-events.md](${publicDomainEventsUrl}). Los addresses, nombres de tipo CloudEvents y payloads marcados como propuesta conservan ese estado abierto.`,
  ].join("\n"));
};

const writeServices = async () => {
  for (const service of services) {
    const serviceDirectory = path.join(domainDirectory, "services", service.id);
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
      sends,
      receives,
      flows: flowRefsForService(service.id),
    }, [
      "## Responsabilidad",
      "",
      service.summary,
      "",
      "## Mensajes relacionados",
      "",
      "| Mensaje | Papel | Canal |",
      "| --- | --- | --- |",
      ...serviceMessageRows(service),
      "",
      "## Flujos que participa",
      "",
      ...flowRefsForService(service.id).map((flow) => `- [${flowById.get(flow.id).name}](${resourcePath("flows", flow.id)})`),
      "",
      "La especificación `asyncapi.yml` de este recurso conserva únicamente las operaciones del servicio, pero mantiene los componentes del contrato canónico para que sus referencias sean resolubles.",
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
      "## Payload de negocio",
      "",
      "El mensaje usa un sobre CloudEvents 1.0 y coloca el payload de negocio en `data`.",
      "",
      fieldsTable(schema),
      "",
      "El archivo `schema.json` contiene el esquema JSON desreferenciado para que pueda ser inspeccionado y reutilizado por herramientas.",
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
      protocols: ["por definir"],
    }, [
      "## Contrato del canal",
      "",
      channel.description,
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
      ...channelMessages.map((message) => `| [${message.name}](${resourcePath(message.type === "command" ? "commands" : "events", message.id)}) | ${message.type} |`),
      "",
      "El address y el transporte se conservan como propuesta porque el contrato fuente todavía no fija broker, protocolo, tópicos ni garantías de entrega.",
    ].join("\n"));
  }
};

const writeFlows = async () => {
  for (const flow of flows) {
    await writeResource(path.join(domainDirectory, "flows", flow.id), {
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
      `La semántica del flujo se deriva de [domain-events.md](${publicDomainEventsUrl}). Los pasos representan la relación entre actores, servicios, mensajes y sistemas externos; no inventan eventos que no existen en el contrato AsyncAPI.`,
    ].join("\n"));
  }
};

await rm(domainDirectory, { recursive: true, force: true });
await rm(path.join(catalogDirectory, "domains", "FMAT Restaurant"), { recursive: true, force: true });
await mkdir(domainDirectory, { recursive: true });
await writeDomain();
await writeServices();
await writeMessages();
await writeChannels();
await writeFlows();

console.log(`EventCatalog generado: 1 dominio, ${services.length} servicios, ${messages.filter((message) => message.type === "command").length} comandos, ${messages.filter((message) => message.type === "event").length} eventos, ${channels.length} canales y ${flows.length} flujos.`);
console.log(`Contrato canónico: ${publicAsyncApiUrl}`);
