---
title: Contrato AsyncAPI
description: Contrato machine-readable de los mensajes operacionales de FMAT Restaurant.
---

# Contrato AsyncAPI

El contrato machine-readable se mantiene en YAML para que pueda validarse, versionarse y consumirse desde herramientas compatibles con [AsyncAPI](https://www.asyncapi.com/).

- [Descargar `FMAT-Restaurant-Events.yml`](FMAT-Restaurant-Events.yml)
- [Explorar el mismo contrato en EventCatalog](https://fmat-restaurant.github.io/Documentation/eventcatalog/)

La publicación se genera automáticamente con el adaptador AsyncAPI de EventCatalog (`@eventcatalog/plugin-doc-generator-asyncapi`). El pipeline ejecuta primero el lint del documento y detiene la publicación si el contrato no es válido.
