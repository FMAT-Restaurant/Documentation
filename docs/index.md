---
title: Documentación de contratos
description: Contratos y flujos operacionales de FMAT Restaurant.
---

<div class="fmat-hero">
<p class="fmat-kicker">FMAT RESTAURANT / INTEGRACIÓN</p>
<h1>Contratos que explican cómo se mueve el restaurante.</h1>
<p class="fmat-lead">Una vista operativa de los eventos, servicios y payloads que conectan Orders &amp; Kitchen, Inventory, Sala y Billing &amp; Payments.</p>
<p class="fmat-actions"><a class="md-button md-button--primary" href="contracts/domain-events/">Explorar contratos</a> <a class="md-button" href="eventcatalog/">Abrir EventCatalog</a></p>
</div>

## Elige una vista

<div class="fmat-card-grid">
<a class="fmat-card" href="contracts/domain-events/">
<span class="fmat-card-index">01</span>
<strong>Eventos de dominio</strong>
<span>Flujos, responsabilidades, confiabilidad y reglas operativas del intercambio de mensajes.</span>
</a>
<a class="fmat-card" href="contracts/FMAT-Restaurant-Events.yml">
<span class="fmat-card-index">02</span>
<strong>Contrato AsyncAPI</strong>
<span>Fuente machine-readable para validadores, generadores y herramientas compatibles con AsyncAPI.</span>
</a>
<a class="fmat-card fmat-card-accent" href="eventcatalog/">
<span class="fmat-card-index">03</span>
<strong>Catálogo EventCatalog</strong>
<span>Mapa navegable de dominios, servicios, mensajes, productores, consumidores y esquemas.</span>
</a>
</div>

## Cómo se publica

Los artefactos se generan desde `docs/contracts/` y se publican automáticamente en GitHub Pages cuando un cambio llega a `main`. El pipeline valida primero AsyncAPI, después genera EventCatalog y finalmente ensambla ambas vistas en un único artefacto de Pages.

!!! info "Punto de entrada recomendado"
    Empieza por [Eventos de dominio e integración](contracts/domain-events.md) para entender el flujo; usa [EventCatalog](https://fmat-restaurant.github.io/Documentation/eventcatalog/) cuando necesites explorar un servicio o el payload concreto de un evento.
