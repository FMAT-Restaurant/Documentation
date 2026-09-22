# FMAT Restaurant · Documentación de contratos

Documentación publicable de los contratos operacionales de FMAT Restaurant.

## Documentación publicada

- [Portal de documentación en GitHub Pages](https://fmat-restaurant.github.io/Documentation/)
- [Eventos de dominio e integración](https://fmat-restaurant.github.io/Documentation/contracts/domain-events/)
- [Contrato AsyncAPI](https://fmat-restaurant.github.io/Documentation/contracts/FMAT-Restaurant-Events.yml)
- [Catálogo EventCatalog](https://fmat-restaurant.github.io/Documentation/eventcatalog/)

## Fuentes del repositorio

- [Eventos de dominio e integración](docs/contracts/domain-events.md)
- [Contrato AsyncAPI](docs/contracts/FMAT-Restaurant-Events.yml)
- [Configuración del sitio](mkdocs.yml)

El workflow [`publish-pages.yml`](.github/workflows/publish-pages.yml) valida el contrato AsyncAPI, genera el catálogo con EventCatalog y publica ambas vistas en GitHub Pages después de cada push a `main`.

## Estructura de EventCatalog

El catálogo se deriva de `docs/contracts/FMAT-Restaurant-Events.yml` en cada build. Su dominio `fmat-restaurant` se desglosa en servicios, comandos, eventos, canales y flujos; los servicios declaran sus mensajes mediante `sends`/`receives` y los mensajes conservan sus canales y esquemas JSON. Los flujos documentan los recorridos descritos en `docs/contracts/domain-events.md` sin convertir estados internos en eventos publicados.
