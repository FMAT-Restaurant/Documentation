# FMAT Restaurant · Documentación de contratos

Documentación publicable de los contratos operacionales de FMAT Restaurant.

- [Eventos de dominio e integración](docs/contracts/domain-events.md)
- [Contrato AsyncAPI](docs/contracts/FMAT-Restaurant-Events.yml)
- [Configuración del sitio](mkdocs.yml)

El workflow [`publish-pages.yml`](.github/workflows/publish-pages.yml) valida el contrato AsyncAPI, genera el catálogo con EventCatalog y publica ambas vistas en GitHub Pages después de cada push a `main`.
