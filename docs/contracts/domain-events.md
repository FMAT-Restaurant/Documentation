---
title: Eventos de dominio e integración operacional
description: Flujos, responsabilidades y reglas de confiabilidad de los contratos de FMAT Restaurant.
---

# Eventos de dominio e integración operacional

> Documento de referencia para comprender los mensajes que cruzan los límites de los servicios de FMAT Restaurant.

## Cómo leer este documento

Este documento describe el comportamiento operacional que debe observarse entre servicios. La tabla resume el catálogo publicado y los diagramas muestran los flujos principales, sus respuestas explícitas y las transiciones que permanecen internas a cada contexto.

El contrato machine-readable está disponible en [`FMAT-Restaurant-Events.yml`](FMAT-Restaurant-Events.yml) y su vista navegable se publica mediante [EventCatalog](https://fmat-restaurant.github.io/Documentation/eventcatalog/). Las direcciones de canal, nombres de tipo CloudEvents y formas exactas de los payloads marcadas como `[Propuesta]` siguen abiertas para confirmación del diseño.

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
