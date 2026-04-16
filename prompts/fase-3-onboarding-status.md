# FASE 3 — Google Merchant Center: Extender onboardingStatus

## Instrucciones de eficiencia
Lee ÚNICAMENTE el archivo indicado. No explores otros archivos. Sé quirúrgico.

---

## Contexto
Fases 1 y 2 completadas. El modelo y el router de Google ya soportan Merchant.

`backend/routes/onboardingStatus.js` expone `GET /api/onboarding/status` que el frontend consume para saber qué integraciones están conectadas. Hoy devuelve `meta`, `googleAds`, `ga4` y `shopify`. Falta agregar `merchant` e `integrationReady.merchant`.

---

## Archivo a leer y modificar
**Uno solo:** `backend/routes/onboardingStatus.js`

---

## Cambios exactos

### 1. Helpers de lectura — agregar junto a los existentes

```js
function hasGoogleOAuthMerchant(gaDoc) {
  return !!(gaDoc?.merchantRefreshToken || gaDoc?.merchantAccessToken);
}

function hasMerchantScope(scopes = []) {
  return normalizeScopes(scopes).some((x) => x.includes('/auth/content'));
}

function merchantAvailableIds(gaDoc) {
  return uniq(
    (Array.isArray(gaDoc?.merchantAccounts) ? gaDoc.merchantAccounts : [])
      .map((a) => String(a?.merchantId || '').trim().replace(/^accounts\//, '').replace(/[^\d]/g, ''))
      .filter(Boolean)
  );
}

function selectedMerchantFromDoc(gaDoc) {
  return uniq(
    (Array.isArray(gaDoc?.selectedMerchantIds) ? gaDoc.selectedMerchantIds : [])
      .map((id) => String(id || '').trim().replace(/^accounts\//, '').replace(/[^\d]/g, ''))
      .filter(Boolean)
  );
}
```

### 2. Select de GoogleAccount — agregar campos Merchant
En la query de `GoogleAccount.findOne(...)`, agrega al `.select(...)`:
```
'merchantRefreshToken merchantAccessToken merchantScope connectedMerchant
 merchantAccounts selectedMerchantIds defaultMerchantId'
```

### 3. Bloque de cálculo Merchant — agregar después del bloque GA4
```js
// ===== MERCHANT =====
const merchantOAuth     = !!(gaDoc && hasGoogleOAuthMerchant(gaDoc));
const merchantScopeOk   = hasMerchantScope(gaDoc?.merchantScope || []);
const merchantConnected = !!(
  (merchantOAuth && merchantScopeOk) || (merchantOAuth && gaDoc?.connectedMerchant)
);

const merchantAvailIds  = gaDoc ? merchantAvailableIds(gaDoc) : [];
const merchantSelectedRaw = selectedMerchantFromDoc(gaDoc || {});
const merchantSelectedEff = effectiveSelected(merchantSelectedRaw, merchantAvailIds).slice(0, MAX_SELECT);

const merchantRequiredSel =
  merchantConnected &&
  merchantAvailIds.length > 0 &&
  requiredSelectionByUX(merchantAvailIds.length, merchantSelectedEff.length);

const merchantDefault =
  gaDoc?.defaultMerchantId
    ? String(gaDoc.defaultMerchantId).trim().replace(/^accounts\//, '').replace(/[^\d]/g, '')
    : (merchantSelectedEff[0] || null);

const merchantIntegrationReady =
  merchantConnected &&
  merchantAvailIds.length > 0 &&
  !merchantRequiredSel &&
  merchantSelectedEff.length > 0;
```

### 4. Payload de respuesta — agregar bloques Merchant
En el objeto `status` del `res.json(...)`, agrega junto a `googleAds` y `ga4`:
```js
merchant: {
  connected:        merchantConnected,
  availableCount:   merchantAvailIds.length,
  selectedCount:    merchantSelectedEff.length,
  requiredSelection: merchantRequiredSel,
  selected:         merchantSelectedEff,
  defaultMerchantId: merchantDefault,
  count:            merchantAvailIds.length,
  maxSelect:        MAX_SELECT,
},
integrationReady: {
  merchant: merchantIntegrationReady,
},
```

---

## Reglas estrictas
- **NO modifiques** los bloques de Meta, Google Ads, GA4 ni Shopify.
- **NO toques** ningún otro archivo.
- Si `hasGoogleOAuthMerchant` o `hasMerchantScope` ya existen en el archivo, verifica que coincidan con esta spec y corrígelos si hay diferencia.

---

## Verificación esperada
1. Sintaxis válida.
2. El payload de `res.json` incluye la clave `merchant` con los campos: `connected`, `availableCount`, `selectedCount`, `requiredSelection`, `selected`, `defaultMerchantId`.
3. El payload incluye `integrationReady.merchant`.
4. Ningún bloque de Meta, Ads, GA4 o Shopify fue modificado.
5. `module.exports = router` presente al final.
