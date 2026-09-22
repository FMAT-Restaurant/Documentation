---
title: Documentación de contratos
description: Contratos y flujos operacionales de FMAT Restaurant.
---

# FMAT Restaurant · Documentación de contratos

Esta página reúne las vistas publicadas de los contratos de integración de FMAT Restaurant.

## Contratos disponibles

- [Eventos de dominio e integración operacional](contracts/domain-events.md): flujos, responsabilidades y reglas de confiabilidad.
- [Contrato AsyncAPI descargable](contracts/FMAT-Restaurant-Events.yml): fuente machine-readable para herramientas compatibles con AsyncAPI.
- [Catálogo de eventos con EventCatalog](eventcatalog/): vista navegable de dominios, servicios, mensajes y esquemas.

## Fuente de publicación

Los artefactos anteriores se generan desde `docs/contracts/` y se publican automáticamente en GitHub Pages cuando un cambio llega a `main`. El pipeline valida el contrato AsyncAPI antes de generar el catálogo y el sitio documental.
