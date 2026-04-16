# TASK: Poblar campos Tier 3/4 en daily_index desde Prisma

## REGLAS ABSOLUTAS
- NO hagas commit ni push.
- Lee cada función antes de modificarla.
- Cambios mínimos, coherentes con el estilo existente.
- Si no hay datos para un día: dejar el campo en `null`, nunca `0`.
- Reporta qué hiciste al terminar cada paso.

---

## Diagnóstico previo (ya mapeado — no re-explorar)

**Archivo central:** `backend/services/mcpContextBuilder.js`

Cada row del `daily_index` ya existe con estos campos hardcodeados en `null`:
```js
// Tier 3 — requiere Pixel
sessions: null,
new_users: null,
landing_page_cvr: null,
add_to_cart_count: null,
checkout_starts: null,

// Tier 4 — requiere Pixel + Shopify/Woo
orders: null,
revenue: null,
roas_reconciled: null,
ncac: null,
mer: null,
cart_abandonment_rate: null,
```

**Prisma no está importado en mcpContextBuilder.js.**
El patrón correcto está en `backend/services/merchantSnapshot.js` línea 1:
```js
const prisma = require('../utils/prismaClient');
```

**Campos relevantes en Prisma (de schema.prisma):**

`Event` model:
- `accountId` (`account_id`) — String
- `eventName` (`event_name`) — String
- `createdAt` (`created_at`) — DateTime
- `sessionId` (`session_id`) — String

`Order` model:
- `accountId` (`account_id`) — String
- `revenue` — Float
- `platformCreatedAt` (`platform_created_at`) — DateTime

**Cómo obtener el `accountId` en `buildStructuredSignalSchema()`:**
Ya existe `unifiedBase` como parámetro. El accountId viene de:
```js
safeStr(unifiedBase?.accountId || unifiedBase?.account_id || '').trim() || null
```
Ver también cómo `merchantSnapshot.js` recibe y usa el accountId — seguir ese patrón.

---

## Paso 1 — Agregar import de Prisma en mcpContextBuilder.js

Al inicio del archivo, junto a los otros `require`, agregar:
```js
let prisma = null;
try {
  prisma = require('../utils/prismaClient');
} catch (_) {
  // Prisma no disponible — campos Tier 3/4 quedarán null
}
```

Usar try/catch para que el módulo no rompa si Prisma no está disponible en el entorno.

---

## Paso 2 — Crear helper `fetchDailyPixelStats(accountId, since, until)`

Agregar esta función **antes** de `buildMetaDailyRows()`. Consulta Prisma y retorna
un `Map<'YYYY-MM-DD', objeto>` con métricas de pixel por día:

```js
async function fetchDailyPixelStats(accountId, since, until) {
  // Retorna Map<date_string, { sessions, new_users, add_to_cart, checkout_starts, purchases_pixel }>
  // since y until son strings 'YYYY-MM-DD'
  if (!prisma || !accountId) return new Map();

  try {
    const from = new Date(since + 'T00:00:00Z');
    const to = new Date(until + 'T23:59:59Z');

    // Contar sesiones únicas por día
    const sessionRows = await prisma.event.groupBy({
      by: ['sessionId'],
      where: {
        accountId,
        createdAt: { gte: from, lte: to },
        eventName: 'page_view',
      },
      _min: { createdAt: true },
    });

    // Agrupar eventos por tipo y día usando findMany + reduce
    // (groupBy de Prisma no soporta truncar por día directamente)
    const events = await prisma.event.findMany({
      where: {
        accountId,
        createdAt: { gte: from, lte: to },
        eventName: {
          in: ['page_view', 'add_to_cart', 'begin_checkout', 'purchase', 'session_start'],
        },
      },
      select: {
        eventName: true,
        sessionId: true,
        createdAt: true,
      },
    });

    // Agrupar por día
    const byDay = new Map();
    for (const ev of events) {
      const day = ev.createdAt.toISOString().slice(0, 10);
      if (!byDay.has(day)) {
        byDay.set(day, {
          sessions: new Set(),
          add_to_cart: 0,
          checkout_starts: 0,
          purchases_pixel: 0,
        });
      }
      const d = byDay.get(day);
      if (ev.eventName === 'page_view' || ev.eventName === 'session_start') {
        d.sessions.add(ev.sessionId);
      }
      if (ev.eventName === 'add_to_cart') d.add_to_cart++;
      if (ev.eventName === 'begin_checkout') d.checkout_starts++;
      if (ev.eventName === 'purchase') d.purchases_pixel++;
    }

    // Convertir Sets a counts
    const result = new Map();
    for (const [day, d] of byDay.entries()) {
      const sessions = d.sessions.size;
      result.set(day, {
        sessions,
        add_to_cart_count: d.add_to_cart,
        checkout_starts: d.checkout_starts,
        purchases_pixel: d.purchases_pixel,
        landing_page_cvr: sessions > 0 && d.checkout_starts > 0
          ? round2((d.checkout_starts / sessions) * 100) : null,
        cart_abandonment_rate: d.add_to_cart > 0 && d.checkout_starts >= 0
          ? round2(((d.add_to_cart - d.checkout_starts) / d.add_to_cart) * 100) : null,
      });
    }

    return result;
  } catch (e) {
    return new Map();
  }
}
```

---

## Paso 3 — Crear helper `fetchDailyOrderStats(accountId, since, until)`

```js
async function fetchDailyOrderStats(accountId, since, until) {
  // Retorna Map<'YYYY-MM-DD', { orders, revenue }>
  if (!prisma || !accountId) return new Map();

  try {
    const from = new Date(since + 'T00:00:00Z');
    const to = new Date(until + 'T23:59:59Z');

    const orders = await prisma.order.findMany({
      where: {
        accountId,
        platformCreatedAt: { gte: from, lte: to },
      },
      select: {
        revenue: true,
        platformCreatedAt: true,
      },
    });

    const byDay = new Map();
    for (const order of orders) {
      const day = order.platformCreatedAt.toISOString().slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, { orders: 0, revenue: 0 });
      const d = byDay.get(day);
      d.orders++;
      d.revenue += toNum(order.revenue);
    }

    const result = new Map();
    for (const [day, d] of byDay.entries()) {
      result.set(day, {
        orders: d.orders,
        revenue: round2(d.revenue),
      });
    }

    return result;
  } catch (e) {
    return new Map();
  }
}
```

---

## Paso 4 — Modificar `buildStructuredSignalSchema()` para pasar los maps a los builders

`buildStructuredSignalSchema()` es `async` o necesita serlo para poder hacer `await`.
Verifica si ya es async — si no, conviértela.

Al inicio de `buildStructuredSignalSchema()`, antes de llamar `buildMetaDailyRows()`,
calcular el rango de fechas desde los chunks disponibles y hacer las queries:

```js
// Determinar rango para queries Prisma
const accountId = safeStr(
  unifiedBase?.accountId || unifiedBase?.account_id || ''
).trim() || null;

const cutoff = new Date();
cutoff.setDate(cutoff.getDate() - 60);
const since = cutoff.toISOString().slice(0, 10);
const until = new Date().toISOString().slice(0, 10);

const [pixelStatsByDay, orderStatsByDay] = accountId
  ? await Promise.all([
      fetchDailyPixelStats(accountId, since, until),
      fetchDailyOrderStats(accountId, since, until),
    ])
  : [new Map(), new Map()];
```

---

## Paso 5 — Pasar los maps a los builders de daily rows y enriquecer cada row

Modificar las llamadas a `buildMetaDailyRows`, `buildGoogleDailyRows`, `buildGa4DailyRows`
para recibir los maps:

```js
const dailyRows = [
  ...(sourceFlags.meta.usable
    ? buildMetaDailyRows(metaPack, pixelStatsByDay, orderStatsByDay) : []),
  ...(sourceFlags.google.usable
    ? buildGoogleDailyRows(googlePack, pixelStatsByDay, orderStatsByDay) : []),
  ...(sourceFlags.ga4.usable
    ? buildGa4DailyRows(ga4Pack, pixelStatsByDay, orderStatsByDay) : []),
];
```

Modificar la firma y el `.map()` de cada builder para enriquecer cada row.
Ejemplo para `buildMetaDailyRows`:

```js
function buildMetaDailyRows(metaPack, pixelStatsByDay = new Map(), orderStatsByDay = new Map()) {
  // ... código existente ...

  return totals.map((row) => {
    // ... campos existentes ...
    const pixel = pixelStatsByDay.get(row.date) || null;
    const orderData = orderStatsByDay.get(row.date) || null;
    const spend = /* el spend ya calculado */;

    return {
      // ... campos existentes sin cambio ...

      // Tier 3
      sessions: pixel?.sessions ?? null,
      add_to_cart_count: pixel?.add_to_cart_count ?? null,
      checkout_starts: pixel?.checkout_starts ?? null,
      landing_page_cvr: pixel?.landing_page_cvr ?? null,
      cart_abandonment_rate: pixel?.cart_abandonment_rate ?? null,

      // Tier 4
      orders: orderData?.orders ?? null,
      revenue: orderData?.revenue ?? null,
      roas_reconciled: spend > 0 && orderData?.revenue != null
        ? round2(orderData.revenue / spend) : null,
      ncac: null,  // requiere datos de clientes nuevos — dejar null por ahora
      mer: null,   // requiere revenue total del negocio — dejar null por ahora
    };
  });
}
```

Aplicar el mismo enriquecimiento en `buildGoogleDailyRows` y `buildGa4DailyRows`
(misma firma, mismo enriquecimiento al final del map).

---

## Paso 6 — Verificación

```bash
node --check backend/services/mcpContextBuilder.js
```

Reporta:
1. Sintaxis OK
2. ¿`buildStructuredSignalSchema` ya era async o tuviste que convertirla?
3. ¿Cuántas llamadas a `buildStructuredSignalSchema` existen en el archivo? (para confirmar que todas usan `await` ahora si se convirtió a async)
4. Cualquier error encontrado

NO hagas commit. NO hagas push.
