# Pixel New Steps — Dashboard + Recording Improvements

Tareas pendientes. No cerrar hasta completar todas y recibir confirmación de pruebas.

## Phase 2: Re-engagement & Customer Context

Tareas enfocadas en evolucionar desde "abandonment intelligence" a "repeat purchase intelligence". Las grabaciones capturan compras completadas, no abandonos, así que el análisis y recomendaciones deben enfocarse en re-engagement.

### 6. Contextualizar grabaciones con sesión y usuario

- [ ] En la lista de grabaciones (`adray-analytics.html`), cada card debe mostrar:
  - [ ] Nombre del cliente (si aplica)
  - [ ] Email o customer ID visible
  - [ ] Sesión origen (relacionar `SessionRecording.sessionId` → `Session.userKey` → customer profile)
  - [ ] Si hay múltiples sesiones del mismo usuario, mostrar "3 sesiones en los últimos 30 días"
- [ ] Backend: enriquecer respuesta de `GET /api/recording/:account_id/list` con customer name, email, session count por user.

---

### 7. Adaptar tooltip de Insights para compras (no abandonos)

- [ ] El tooltip "Insights" dentro del panel de "Selected Journey" actualmente habla sobre abandonment patterns, pero esos son pedidos YA REALIZADOS.
- [ ] Cambiar el narrative/recommendation para contextos de compra completada:
  - En lugar de "shipping shock → ofrecer envío gratis": "usuario alcanzó al checkout a pesar de shipping shock → oportunidad de free shipping en siguiente compra"
  - En lugar de "rage clicks en búsqueda": "el usuario tuvo friction en product discovery pero convirtió → optimizar búsqueda para que convierta MÁS rápido"
  - En lugar de "hesitation en selector de cupón": "conversión a pesar de UX friction → cupón es barrera pero NO dealbreaker"
- [ ] Backend: endpoint `/api/recording/:account_id/:recording_id/insights` debe detectar si outcome=PURCHASED e invocar LLM con prompt diferente orientado a "cómo retener + re-activar" en lugar de "cómo recuperar abandono".

---

### 8. IA recommendations enfocadas en re-engagement

- [ ] Las recomendaciones (key recommendation en card + "Generar con IA" button) deben incorporar:
  - [ ] Contexto de compra: monto, productos, categorías, frecuencia de compra previas
  - [ ] Behavioral data: duración sesión, dispositivo, qué página visitó antes de checkout
  - [ ] Clarity session insights si disponible (qué buscó, qué dudó)
  - [ ] Recording friction signals (qué los hizo dudar pero igual compraron)
  - [ ] Purchase history: ¿es cliente nuevo o repeat? ¿Cuánto gastó antes? ¿Cuál es el AOV trend?
- [ ] Output LLM: "key recommendation" debe ser acción específica de re-engagement (ej: "Enviar email en 3 días con producto complementario al que compró porque su hesitation en XYZ indica interés en [categoria]")
- [ ] Backend: ampliar `recordingNarrativeService.js` para:
  - [ ] Aceptar parámetro `outcome` (PURCHASED vs ABANDONED) para cambiar el prompt
  - [ ] Fetchear Order details si `outcome=PURCHASED` (revenue, products, customer history)
  - [ ] Inyectar purchase context en el prompt de Gemma
  - [ ] Retornar `nextBestAction` estructurado (type: "email" | "coupon" | "retargeting", parameters: {...})

---

## Preguntas bloqueantes para el usuario

- **Punto 2**: ¿Te parece bien el diseño propuesto de panel Insights (header + overview + signals pills + pattern + IA card)? ¿Alguna métrica adicional que consideres crítica? ¿Siempre invocamos LLM o sólo cuando el usuario hace click en "generar insight" (menor costo)?
- **Punto 1**: ¿El merchant usa checkout hosted de Shopify o WooCommerce same-domain? Confirmar para saber si vale la pena documentar limitación o ampliarla con inyección en checkout externo.
