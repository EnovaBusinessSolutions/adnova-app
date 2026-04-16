# FASE 1 — Google Merchant Center: Extender modelo GoogleAccount

## Contexto
Estás trabajando en el repositorio de **Adray AI**, una plataforma B2B SaaS de marketing attribution.

Hoy el sistema ya tiene OAuth funcionando para **Meta Ads**, **Google Ads** y **Google Analytics 4 (GA4)**. Todo eso funciona en producción y **no debes tocarlo bajo ninguna circunstancia**.

El objetivo de esta fase es únicamente extender el modelo `GoogleAccount.js` para soportar **Google Merchant Center** como tercer producto Google, siguiendo el mismo patrón que ya existe para Ads y GA4.

---

## Archivo a modificar

**Uno solo:** `backend/models/GoogleAccount.js`

Lee ese archivo completo antes de hacer cualquier cambio.

---

## Lo que debes hacer

Agrega los siguientes campos al schema de `GoogleAccountSchema`, **después del bloque de GA4 y antes de los flags de conexión** (`connectedAds`, `connectedGa4`), siguiendo el mismo estilo y orden que los campos de GA4:

### Tokens Merchant (separados de Ads y GA4)
```js
merchantAccessToken:  { type: String, select: false, default: null },
merchantRefreshToken: { type: String, select: false, default: null },
merchantScope:        { type: [String], default: [], set: normScopes },
merchantExpiresAt:    { type: Date, default: null },
merchantConnectedAt:  { type: Date, default: null },
```

### Flag de conexión Merchant (junto a connectedAds y connectedGa4)
```js
connectedMerchant: { type: Boolean, default: false },
```

### Subdocumento MerchantAccount
Crea un subdocumento `MerchantAccountSchema` con el mismo patrón que `GaPropertySchema` y `AdAccountSchema`:
```js
const MerchantAccountSchema = new Schema(
  {
    merchantId:    { type: String, index: true, set: normMerchantId },
    displayName:   String,
    websiteUrl:    String,
    accountStatus: String,
    aggregatorId:  { type: String, set: normMerchantId, default: null },
    source:        { type: String, default: 'merchant' },
  },
  { _id: false }
);
```

### Campos de cuentas y selección Merchant (junto a gaProperties, selectedPropertyIds)
```js
merchantAccounts:    { type: [MerchantAccountSchema], default: [] },
defaultMerchantId:   { type: String, set: normMerchantId, default: null },
selectedMerchantIds: { type: [String], default: [], set: normMerchantArr },
```

### Logs de discovery Merchant (junto a lastAdsDiscoveryError)
```js
lastMerchantDiscoveryError: { type: String, default: null },
lastMerchantDiscoveryLog:   { type: Schema.Types.Mixed, default: null, select: false },
```

---

## Helpers a agregar

Agrega estos normalizadores **junto a los helpers existentes** (`normCustomerId`, `normPropertyId`, etc.):

```js
const normMerchantId = (val = '') =>
  String(val || '')
    .trim()
    .replace(/^accounts\//, '')
    .replace(/[^\d]/g, '');

const normMerchantArr = (arr) =>
  Array.from(
    new Set((Array.isArray(arr) ? arr : []).map(normMerchantId).filter(Boolean))
  );
```

---

## Métodos de instancia a agregar

Agrega estos métodos siguiendo el mismo patrón que `setTokens` y `setGa4Tokens`:

```js
GoogleAccountSchema.methods.setMerchantTokens = function ({
  access_token,
  refresh_token,
  expires_at,
  scope,
} = {}) {
  if (access_token !== undefined)  this.merchantAccessToken  = access_token;
  if (refresh_token !== undefined) this.merchantRefreshToken = refresh_token;
  if (expires_at !== undefined)
    this.merchantExpiresAt = expires_at instanceof Date ? expires_at : new Date(expires_at);
  if (scope !== undefined) this.merchantScope = normScopes(scope);
  if (refresh_token || access_token) this.merchantConnectedAt = new Date();
  return this;
};

GoogleAccountSchema.methods.setMerchantAccounts = function (arr = []) {
  const list = Array.isArray(arr) ? arr : [];
  const map = new Map();
  for (const a of list) {
    const merchantId = normMerchantId(a?.merchantId || a?.id || a?.name);
    if (!merchantId) continue;
    map.set(merchantId, {
      merchantId,
      displayName:   a?.displayName || a?.accountName || `Merchant ${merchantId}`,
      websiteUrl:    a?.websiteUrl || null,
      accountStatus: a?.accountStatus || null,
      aggregatorId:  normMerchantId(a?.aggregatorId || ''),
      source:        'merchant',
    });
  }
  this.merchantAccounts = Array.from(map.values()).sort((a, b) =>
    String(a.displayName || a.merchantId).localeCompare(String(b.displayName || b.merchantId))
  );
  return this;
};
```

---

## Virtual a agregar

Agrega este virtual junto a `hasAdsScope` y `hasGaScope`:

```js
GoogleAccountSchema.virtual('hasMerchantScope').get(function () {
  const s1 = Array.isArray(this.scope) ? this.scope : [];
  const s2 = Array.isArray(this.merchantScope) ? this.merchantScope : [];
  const MERCHANT_SCOPE = 'https://www.googleapis.com/auth/content';
  return s1.includes(MERCHANT_SCOPE) || s2.includes(MERCHANT_SCOPE);
});
```

---

## Índices a agregar

Agrega estos índices junto a los existentes:

```js
GoogleAccountSchema.index({ 'merchantAccounts.merchantId': 1 });
GoogleAccountSchema.index({ user: 1, selectedMerchantIds: 1 });
```

---

## toJSON / toObject

En los transformers de `toJSON` y `toObject`, agrega:
```js
delete ret.merchantAccessToken;
delete ret.merchantRefreshToken;
```
para que los tokens Merchant nunca se expongan en respuestas JSON, igual que `accessToken` y `ga4AccessToken`.

---

## Reglas estrictas

- **NO modifiques** ningún campo existente de Ads ni GA4.
- **NO cambies** `setTokens`, `setGa4Tokens`, ni ningún método existente.
- **NO toques** ningún otro archivo fuera de `backend/models/GoogleAccount.js`.
- Sigue el mismo estilo de código, naming y orden que el archivo ya tiene.
- Si el archivo ya tiene alguno de estos campos agregados previamente, verifica que coincidan exactamente con esta especificación y corrígelos si hay diferencia — pero sin alterar los campos de Ads/GA4.

---

## Verificación esperada

Al terminar, confirma:
1. El archivo compila sin errores de sintaxis (`node --check` o equivalente).
2. Los campos `merchantAccessToken` y `merchantRefreshToken` tienen `select: false`.
3. `connectedMerchant` existe junto a `connectedAds` y `connectedGa4`.
4. `selectedMerchantIds` usa el setter `normMerchantArr`.
5. `toJSON` y `toObject` eliminan los tokens Merchant de la respuesta.
6. Ningún campo de Ads o GA4 fue modificado.
