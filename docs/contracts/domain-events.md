---
title: Eventos de dominio e integración operacional
description: Flujos, responsabilidades y reglas de confiabilidad de los contratos de FMAT Restaurant.
eventcatalog:
  actors:
    - id: waiter-ui
      name: Mesero / UI
      label: crea órdenes y confirma el servicio
      direction: inbound
    - id: refund-operator
      name: Administrador / Caja
      label: solicita reembolsos
      direction: inbound
  flows:
    - id: order-fulfillment
      name: Creación de orden hasta finalización
      summary: Recorrido principal desde la solicitud de una orden hasta su servicio y el resultado del pago/cierre.
      steps:
        - id: start
          title: El mesero solicita una orden
          actor:
            name: Mesero / UI
          next_step: orders-create
        - id: orders-create
          title: Orders & Kitchen valida y registra la orden
          service: { id: orders-kitchen, version: 0.1.0 }
          next_step: reservation-request
        - id: reservation-request
          title: Solicitar la reserva inicial
          message: { id: InventoryReservationRequested, version: 0.1.0 }
          next_step: inventory-reserve
        - id: inventory-reserve
          title: Inventory valida y reserva los recursos
          service: { id: inventory, version: 0.1.0 }
          next_step: reservation-confirmed
        - id: reservation-confirmed
          title: Reserva confirmada
          message: { id: InventoryReservationConfirmed, version: 0.1.0 }
          next_step: preparation-start
        - id: preparation-start
          title: Orders & Kitchen inicia la preparación
          service: { id: orders-kitchen, version: 0.1.0 }
          next_step: preparation-started
        - id: preparation-started
          title: Notificar el inicio de preparación
          message: { id: PreparationStarted, version: 0.1.0 }
          next_step: inventory-consume
        - id: inventory-consume
          title: Inventory convierte la reserva en consumo
          service: { id: inventory, version: 0.1.0 }
          next_step: order-ready
        - id: order-ready
          title: Orders & Kitchen informa que la orden está lista
          message: { id: OrderReady, version: 0.1.0 }
          next_step: sala-ready
        - id: sala-ready
          title: Sala prepara la orden para servir
          service: { id: sala, version: 0.1.0 }
          next_step: waiter-serves
        - id: waiter-serves
          title: El mesero confirma que la orden fue servida
          actor:
            name: Mesero / UI
          next_step: order-served
        - id: order-served
          title: Notificar que la orden fue servida
          message: { id: OrderServed, version: 0.1.0 }
          next_step: billing-account
        - id: billing-account
          title: Billing & Payments crea o actualiza la cuenta
          service: { id: billing-payments, version: 0.1.0 }
          next_step: payment-request
        - id: payment-request
          title: El mesero solicita el pago
          actor:
            name: Mesero / UI
          next_step: payment-provider
        - id: payment-provider
          title: Procesar el pago
          externalSystem:
            name: Proveedor de pagos (no especificado)
            summary: El proveedor concreto y el contrato de respuesta no están definidos.
          next_steps:
            - id: account-close
              label: Cuenta completamente saldada
            - id: balance-pending
              label: Saldo pendiente
        - id: account-close
          title: Billing & Payments cierra la cuenta
          service: { id: billing-payments, version: 0.1.0 }
          next_step: account-closed
        - id: account-closed
          title: Notificar el cierre de cuenta
          message: { id: AccountClosed, version: 0.1.0 }
          next_step: sala-release
        - id: sala-release
          title: Sala actualiza el estado y libera la mesa
          service: { id: sala, version: 0.1.0 }
        - id: balance-pending
          title: Pago registrado con saldo pendiente
          summary: Estado síncrono; no existe un mensaje AsyncAPI para este resultado.
    - id: order-creation-failure
      name: Creación de orden con falla
      summary: Distingue los errores locales de creación y la compensación cuando Inventory rechaza la reserva.
      steps:
        - id: start
          title: El mesero solicita una orden
          actor:
            name: Mesero / UI
          next_step: orders-create
        - id: orders-create
          title: Orders & Kitchen valida y persiste la orden
          service: { id: orders-kitchen, version: 0.1.0 }
          next_steps:
            - id: reservation-request
              label: Orden persistida
            - id: local-error
              label: Solicitud inválida o error de persistencia
        - id: local-error
          title: Error local sin mensaje publicado
          summary: La solicitud inválida o el fallo al persistir no tienen un mensaje definido en AsyncAPI.
        - id: reservation-request
          title: Solicitar la reserva inicial
          message: { id: InventoryReservationRequested, version: 0.1.0 }
          next_step: inventory-reserve
        - id: inventory-reserve
          title: Inventory valida la disponibilidad
          service: { id: inventory, version: 0.1.0 }
          next_steps:
            - id: reservation-confirmed
              label: Inventario disponible
            - id: reservation-rejected
              label: Inventario insuficiente
        - id: reservation-confirmed
          title: Reserva confirmada
          message: { id: InventoryReservationConfirmed, version: 0.1.0 }
        - id: reservation-rejected
          title: Reserva rechazada
          message: { id: InventoryReservationRejected, version: 0.1.0 }
          next_step: orders-cancel
        - id: orders-cancel
          title: Orders & Kitchen cancela la orden
          service: { id: orders-kitchen, version: 0.1.0 }
          next_step: order-cancelled
        - id: order-cancelled
          title: Notificar la cancelación
          message: { id: OrderCancelled, version: 0.1.0 }
          next_step: inventory-release
        - id: inventory-release
          title: Inventory libera cualquier reserva parcial
          service: { id: inventory, version: 0.1.0 }
    - id: order-update
      name: Actualización de una orden
      summary: La actualización con impacto en inventario solo se confirma después de que Inventory confirma el ajuste.
      steps:
        - id: start
          title: El mesero solicita un cambio
          actor:
            name: Mesero / UI
          next_step: orders-check
        - id: orders-check
          title: Orders & Kitchen valida el estado y los cambios
          service: { id: orders-kitchen, version: 0.1.0 }
          next_steps:
            - id: adjustment-request
              label: Cambio válido con impacto en inventario
            - id: local-outcome
              label: Sin impacto, cambio inválido o preparación iniciada
        - id: local-outcome
          title: Resultado local sin mensaje de integración definido
          summary: Estos resultados permanecen dentro de Orders & Kitchen en el contrato actual.
        - id: adjustment-request
          title: Solicitar el ajuste de reserva
          message: { id: InventoryReservationAdjustmentRequested, version: 0.1.0 }
          next_step: inventory-adjust
        - id: inventory-adjust
          title: Inventory valida el ajuste solicitado
          service: { id: inventory, version: 0.1.0 }
          next_steps:
            - id: adjustment-confirmed
              label: Ajuste posible
            - id: adjustment-rejected
              label: Inventario insuficiente
        - id: adjustment-confirmed
          title: Ajuste de reserva confirmado
          message: { id: InventoryReservationAdjusted, version: 0.1.0 }
          next_step: orders-confirm
        - id: adjustment-rejected
          title: Ajuste de reserva rechazado
          message: { id: InventoryReservationRejected, version: 0.1.0 }
          next_step: orders-discard
        - id: orders-confirm
          title: Orders & Kitchen confirma el cambio y avanza la versión
          service: { id: orders-kitchen, version: 0.1.0 }
        - id: orders-discard
          title: Orders & Kitchen descarta el cambio pendiente
          service: { id: orders-kitchen, version: 0.1.0 }
    - id: payment-failure
      name: Fallo de pago
      summary: Modela el pago aprobado o rechazado sin inventar un evento de pago; AccountClosed solo se publica al liquidar la cuenta completa.
      steps:
        - id: start
          title: Mesero o caja solicita el pago
          actor:
            name: Mesero / Caja / UI
          next_step: billing-validate
        - id: billing-validate
          title: Billing & Payments valida la cuenta y el monto
          service: { id: billing-payments, version: 0.1.0 }
          next_step: provider-process
        - id: provider-process
          title: El proveedor procesa el pago
          externalSystem:
            name: Proveedor de pagos (no especificado)
            summary: Proveedor externo; las respuestas no están especificadas como mensajes AsyncAPI.
          next_steps:
            - id: payment-approved
              label: Pago aprobado
            - id: payment-rejected
              label: Pago rechazado
        - id: payment-approved
          title: Billing & Payments registra el pago
          service: { id: billing-payments, version: 0.1.0 }
          next_steps:
            - id: account-closed
              label: Cuenta completamente saldada
            - id: balance-pending
              label: Queda saldo pendiente
        - id: account-closed
          title: Cuenta cerrada
          message: { id: AccountClosed, version: 0.1.0 }
          next_step: sala-update
        - id: sala-update
          title: Sala libera la mesa
          service: { id: sala, version: 0.1.0 }
        - id: balance-pending
          title: Pago exitoso, saldo pendiente
          summary: Respuesta síncrona; no se publica AccountClosed.
        - id: payment-rejected
          title: Billing & Payments registra el intento fallido
          service: { id: billing-payments, version: 0.1.0 }
          next_step: rejected-response
        - id: rejected-response
          title: Pago rechazado sin evento de cierre
          summary: Respuesta síncrona; no se publica AccountClosed.
    - id: payment-refund
      name: Reembolso
      summary: Solo el reembolso confirmado por el proveedor genera PaymentRefunded.
      steps:
        - id: start
          title: Administrador o caja solicita un reembolso
          actor:
            name: Administrador / Caja
          next_step: billing-validate
        - id: billing-validate
          title: Billing & Payments busca el pago y valida el reembolso
          service: { id: billing-payments, version: 0.1.0 }
          next_steps:
            - id: refund-denied
              label: Reembolso no permitido
            - id: provider-request
              label: Reembolso permitido
        - id: refund-denied
          title: Reembolso rechazado localmente
          summary: No se solicita al proveedor ni se publica un evento.
        - id: provider-request
          title: Solicitar el reembolso
          externalSystem:
            name: Proveedor de pagos (no especificado)
            summary: El proveedor concreto y su contrato de respuesta no están definidos.
          next_steps:
            - id: provider-rejected
              label: El proveedor rechaza el reembolso
            - id: provider-approved
              label: El proveedor confirma el reembolso
        - id: provider-rejected
          title: Billing & Payments registra el intento fallido
          service: { id: billing-payments, version: 0.1.0 }
          next_step: refund-failed
        - id: refund-failed
          title: Reembolso no realizado; no se publica PaymentRefunded
        - id: provider-approved
          title: Billing & Payments registra el reembolso confirmado
          service: { id: billing-payments, version: 0.1.0 }
          next_step: payment-refunded
        - id: payment-refunded
          title: Notificar el reembolso confirmado
          message: { id: PaymentRefunded, version: 0.1.0 }
          next_step: sala-update
        - id: sala-update
          title: Sala actualiza el estado visible si aplica
          service: { id: sala, version: 0.1.0 }
---

# Eventos de dominio e integración operacional

> Documento de referencia para comprender los mensajes que cruzan los límites de los servicios de FMAT Restaurant.

## Cómo leer este documento

Este documento describe el comportamiento operacional que debe observarse entre servicios. La tabla resume el catálogo publicado y los diagramas muestran los flujos principales, sus respuestas explícitas y las transiciones que permanecen internas a cada contexto.

El contrato machine-readable está disponible en [`FMAT-Restaurant-Events.yml`](FMAT-Restaurant-Events.yml) y su vista navegable se publica mediante [EventCatalog](https://fmat-restaurant.github.io/Documentation/eventcatalog/). Las direcciones de canal, nombres de tipo CloudEvents y formas exactas de los payloads marcadas como `[Propuesta]` siguen abiertas para confirmación del diseño.

Los cinco flujos estructurados del frontmatter alimentan los diagramas de EventCatalog. Esta separación mantiene el texto y los diagramas Mermaid legibles en GitHub Pages, y permite que el catálogo relacione cada paso con su servicio o mensaje sin convertir interacciones internas en eventos publicados.

## Alcance

Los mensajes publicados mediante el broker representan contratos entre servicios. Los eventos internos de un contexto, como `OrderCreated` u `OrderUpdated`, pueden seguir existiendo dentro de `Orders & Kitchen`, pero no necesitan publicarse si ningún servicio externo los consume directamente.

## Resumen de mensajes operacionales

| Mensaje                                   | Tipo    | Propósito                                                                                         | Productor          | Consumidor         |
| ----------------------------------------- | ------- | ------------------------------------------------------------------------------------------------- | ------------------ | ------------------ |
| `InventoryReservationRequested`           | Comando | Solicitar la reserva inicial necesaria para una orden                                             | Orders & Kitchen   | Inventory          |
| `InventoryReservationConfirmed`           | Evento  | Informar que la reserva inicial fue realizada correctamente                                       | Inventory          | Orders & Kitchen   |
| `InventoryReservationRejected`            | Evento  | Informar que una reserva o ajuste no pudo realizarse                                              | Inventory          | Orders & Kitchen   |
| `InventoryReservationAdjustmentRequested` | Comando | Solicitar el ajuste de una reserva debido a cambios en una orden                                  | Orders & Kitchen   | Inventory          |
| `InventoryReservationAdjusted`            | Evento  | Informar que el ajuste solicitado fue realizado correctamente                                     | Inventory          | Orders & Kitchen   |
| `PreparationStarted`                      | Evento  | Informar que comenzó la preparación y que la reserva correspondiente puede considerarse consumida | Orders & Kitchen   | Inventory          |
| `OrderCancelled`                          | Evento  | Informar que una orden fue cancelada y liberar reservas que aún no hayan sido consumidas          | Orders & Kitchen   | Inventory          |
| `OrderReady`                              | Evento  | Informar que una orden está lista para ser servida                                                | Orders & Kitchen   | Sala               |
| `OrderServed`                             | Evento  | Informar que una orden fue servida                                                                | Sala               | Billing & Payments |
| `AccountClosed`                           | Evento  | Informar que una cuenta quedó completamente saldada y cerrada                                     | Billing & Payments | Sala               |
| `PaymentRefunded`                         | Evento  | Informar que un pago fue reembolsado                                                              | Billing & Payments | Sala               |

## Flujos publicados en EventCatalog

| Flujo | Alcance |
| --- | --- |
| [Creación de orden hasta finalización](https://fmat-restaurant.github.io/Documentation/eventcatalog/docs/flows/order-fulfillment/0.1.0/) | Reserva, preparación, servicio, pago y cierre si la cuenta queda saldada. |
| [Creación de orden con falla](https://fmat-restaurant.github.io/Documentation/eventcatalog/docs/flows/order-creation-failure/0.1.0/) | Errores locales, rechazo de reserva y cancelación compensatoria. |
| [Actualización de una orden](https://fmat-restaurant.github.io/Documentation/eventcatalog/docs/flows/order-update/0.1.0/) | Ajuste de inventario antes de confirmar o descartar el cambio. |
| [Fallo de pago](https://fmat-restaurant.github.io/Documentation/eventcatalog/docs/flows/payment-failure/0.1.0/) | Respuestas del proveedor y condición explícita para publicar `AccountClosed`. |
| [Reembolso](https://fmat-restaurant.github.io/Documentation/eventcatalog/docs/flows/payment-refund/0.1.0/) | Validación, confirmación externa y publicación de `PaymentRefunded`. |

---

## 1. Creación de orden hasta finalización — Happy Path

```mermaid
sequenceDiagram
    autonumber

    actor Waiter as Mesero / UI

    participant OK as Orders & Kitchen
    participant Broker as Event Broker
    participant Inv as Inventory
    participant Sala
    participant BP as Billing & Payments

    Waiter->>OK: Crear orden

    OK->>OK: Validar solicitud
    OK->>OK: Persistir orden como PENDING_RESERVATION

    OK-->>Waiter: Orden recibida / pendiente de confirmación

    OK->>Broker: InventoryReservationRequested
    Broker-->>Inv: InventoryReservationRequested

    Inv->>Inv: Validar disponibilidad

    Inv->>Inv: Crear reserva
    Inv->>Broker: InventoryReservationConfirmed
    Broker-->>OK: InventoryReservationConfirmed

    OK->>OK: Confirmar orden

    Note over OK,Waiter: La UI puede obtener el nuevo estado mediante push, polling o consulta posterior

    OK->>OK: Iniciar preparación

    OK->>Broker: PreparationStarted
    Broker-->>Inv: PreparationStarted

    Inv->>Inv: Convertir reserva en consumo

    OK->>OK: Completar preparación

    OK->>Broker: OrderReady
    Broker-->>Sala: OrderReady

    Sala->>Sala: Marcar orden lista para servir

    Waiter->>Sala: Confirmar orden servida

    Sala->>Broker: OrderServed
    Broker-->>BP: OrderServed

    BP->>BP: Crear / actualizar cuenta

    Waiter->>BP: Solicitar pago

    BP->>BP: Procesar pago
    BP->>BP: Registrar pago

    alt Cuenta completamente saldada
        BP->>BP: Cerrar cuenta
        BP->>Broker: AccountClosed
        Broker-->>Sala: AccountClosed

        Sala->>Sala: Actualizar estado y liberar mesa
    else Saldo pendiente
        BP-->>Waiter: Pago registrado / saldo pendiente
    end
```

---

## 2. Creación de orden con falla

```mermaid
sequenceDiagram
    autonumber

    actor Waiter as Mesero / UI

    participant OK as Orders & Kitchen
    participant Broker as Event Broker
    participant Inv as Inventory

    Waiter->>OK: Crear orden

    alt Solicitud inválida

        OK->>OK: Validar datos y reglas de negocio
        OK-->>Waiter: Error de validación

    else Error al persistir

        OK->>OK: Intentar persistir orden
        OK-->>Waiter: Error al crear orden

    else Orden persistida

        OK->>OK: Persistir como PENDING_RESERVATION
        OK-->>Waiter: Orden recibida / pendiente de confirmación

        OK->>Broker: InventoryReservationRequested
        Broker-->>Inv: InventoryReservationRequested

        Inv->>Inv: Validar disponibilidad

        alt Inventario disponible

            Inv->>Inv: Crear reserva

            Inv->>Broker: InventoryReservationConfirmed
            Broker-->>OK: InventoryReservationConfirmed

            OK->>OK: Confirmar orden

        else Inventario insuficiente

            Inv->>Broker: InventoryReservationRejected
            Broker-->>OK: InventoryReservationRejected

            OK->>OK: Marcar orden como CANCELLED

            OK->>Broker: OrderCancelled
            Broker-->>Inv: OrderCancelled

            Inv->>Inv: Liberar cualquier reserva parcial existente

            Note over OK,Waiter: La UI recibe posteriormente el estado de cancelación

        end

    end
```

---

## 3. Actualización de una orden

El control sobre si la orden ya comenzó a prepararse pertenece a `Orders & Kitchen`.

Una actualización que no modifica los requerimientos de inventario puede aplicarse inmediatamente.

Una actualización que sí modifica los requerimientos debe esperar la confirmación de Inventory antes de hacerse definitiva.

```mermaid
sequenceDiagram
    autonumber

    actor Waiter as Mesero / UI

    participant OK as Orders & Kitchen
    participant Broker as Event Broker
    participant Inv as Inventory

    Waiter->>OK: Actualizar orden

    OK->>OK: Consultar orden y estado

    alt Preparación ya iniciada

        OK-->>Waiter: Actualización rechazada

    else Orden modificable

        OK->>OK: Validar cambios

        alt Cambio inválido

            OK-->>Waiter: Cambio rechazado

        else Cambio válido sin impacto en inventario

            OK->>OK: Aplicar y persistir cambio
            OK-->>Waiter: Orden actualizada

        else Cambio válido con impacto en inventario

            OK->>OK: Crear cambio pendiente
            OK->>OK: Asignar proposedOrderVersion

            OK-->>Waiter: Actualización pendiente de confirmación

            OK->>Broker: InventoryReservationAdjustmentRequested
            Broker-->>Inv: InventoryReservationAdjustmentRequested

            Inv->>Inv: Validar ajuste solicitado

            alt Ajuste posible

                Inv->>Inv: Actualizar reserva

                Inv->>Broker: InventoryReservationAdjusted
                Broker-->>OK: InventoryReservationAdjusted

                OK->>OK: Confirmar cambio pendiente
                OK->>OK: Avanzar orderVersion

                Note over OK,Waiter: La UI recibe el nuevo estado confirmado

            else Inventario insuficiente

                Inv->>Broker: InventoryReservationRejected
                Broker-->>OK: InventoryReservationRejected

                OK->>OK: Descartar cambio pendiente

                Note over OK,Waiter: La UI recibe que el cambio fue rechazado

            end

        end

    end
```

De esta forma no es necesario:

```text
actualizar
→ confirmar al usuario
→ Inventory rechaza
→ revertir actualización
```

El cambio únicamente se vuelve definitivo cuando Inventory confirma el ajuste.

---

## 4. Fallo de pago

```mermaid
sequenceDiagram
    autonumber

    actor User as Mesero / Caja / UI

    participant BP as Billing & Payments
    participant Provider as Proveedor de pago
    participant Broker as Event Broker
    participant Sala

    User->>BP: Solicitar pago

    BP->>BP: Validar cuenta y monto

    BP->>Provider: Procesar pago

    alt Pago aprobado

        Provider-->>BP: Pago aprobado

        BP->>BP: Registrar pago

        alt Cuenta completamente saldada

            BP->>BP: Cerrar cuenta

            BP->>Broker: AccountClosed
            Broker-->>Sala: AccountClosed

            Sala->>Sala: Liberar mesa

            BP-->>User: Pago exitoso / cuenta cerrada

        else Saldo restante

            BP-->>User: Pago exitoso / saldo pendiente

        end

    else Pago rechazado

        Provider-->>BP: Pago rechazado

        BP->>BP: Registrar intento fallido

        BP-->>User: Pago rechazado

        Note over BP,Sala: No se publica AccountClosed

    end
```

`AccountClosed` solo se publica cuando el saldo de la cuenta llega efectivamente a cero.

Un pago exitoso individual no implica necesariamente que la cuenta completa haya sido cerrada.

---

## 5. Reembolso

El reembolso pertenece al dominio de pagos, por lo que el evento representa un pago reembolsado y no una orden reembolsada.

```mermaid
sequenceDiagram
    autonumber

    actor User as Administrador / Caja

    participant BP as Billing & Payments
    participant Provider as Proveedor de pago
    participant Broker as Event Broker
    participant Sala

    User->>BP: Solicitar reembolso

    BP->>BP: Buscar pago
    BP->>BP: Validar reembolso

    alt Reembolso no permitido

        BP-->>User: Reembolso rechazado

    else Reembolso permitido

        BP->>Provider: Solicitar reembolso

        alt Proveedor rechaza reembolso

            Provider-->>BP: Reembolso rechazado

            BP->>BP: Registrar intento fallido

            BP-->>User: No fue posible realizar el reembolso

        else Reembolso aprobado

            Provider-->>BP: Reembolso realizado

            BP->>BP: Registrar reembolso

            BP->>Broker: PaymentRefunded
            Broker-->>Sala: PaymentRefunded

            Sala->>Sala: Actualizar estado visible si aplica

            BP-->>User: Reembolso realizado

        end

    end
```

Un `PaymentRefunded` no implica automáticamente que la mesa deba volver a abrirse ni que la orden cambie de estado.

---

## 6. Estados internos de preparación

Los estados internos:

```mermaid
flowchart LR
    A[IN_PREPARATION] -->|Preparación completada| B[READY]
    B -->|Orden servida| C[SERVED]
    C -->|Cuenta cerrada| D[CLOSED]

    A -->|Orden cancelada antes de preparación| E[CANCELLED]
    B -->|Orden cancelada antes de servirse| E
```

Pertenecen a `Orders & Kitchen`.

No es necesario publicar cada transición en el broker.

La única excepción operacional es:

```text
PreparationStarted
```

porque Inventory necesita conocer ese momento para transformar:

```mermaid
flowchart LR
    A[AVAILABLE] -->|Reserva solicitada| B[RESERVED]
    B -->|Preparación iniciada| C[CONSUMED]
```

La finalización de la preparación produce:

```text
OrderReady
```

porque Sala sí necesita reaccionar a ese hecho.

---

## Ciclo de inventario

La reserva debe tener una semántica explícita:

```mermaid
flowchart LR
    A[AVAILABLE] -->|Reserva solicitada| B[RESERVED]
    B -->|Preparación iniciada| C[CONSUMED]
    B -->|Orden cancelada antes de preparación| A
```

Una vez que una reserva ha pasado a `CONSUMED`, una cancelación posterior de la orden no debe restaurar automáticamente ese inventario.

Cualquier devolución física de inventario después de comenzar la preparación debe tratarse mediante una operación explícita de ajuste de inventario.

---

## 7. Correlación y versionado

Inventory debe ignorar mensajes duplicados y evitar aplicar una actualización correspondiente a una versión obsoleta.

Ejemplo:

```mermaid
flowchart LR
    A[Order v4] -->|propuesta v5| B[InventoryReservationAdjustmentRequestedV5]
    B -->|Inventory confirma v5| C[InventoryReservationAdjustedV5]
    C -->|Order v5 confirmada| D[Order v5]
```

Un rechazo correspondiente a `v4` o a una solicitud anterior no debe modificar una orden que ya se encuentre en `v5`.

---

## Reglas de confiabilidad

Los consumidores de los eventos deben ser idempotentes.

La publicación de mensajes debe evitar el problema:

```mermaid
flowchart LR
    A[persistir en BD] -->|publicar evento| B[publicar evento]
    B -->|fallar antes de persistir| C[fallar antes de persistir]
```

por lo que es recomendable utilizar el patrón **Transactional Outbox**.

Los consumidores pueden utilizar un **Inbox / processed-message store** para detectar mensajes ya procesados.

La consistencia entre servicios es eventual y ninguna operación debe depender de que la ausencia de un evento signifique éxito.

Por eso siempre existen respuestas explícitas:

```text
InventoryReservationConfirmed
```

o:

```text
InventoryReservationRejected
```

en lugar de asumir que:

```text
"No llegó rechazo" = "la reserva fue aceptada"
```
