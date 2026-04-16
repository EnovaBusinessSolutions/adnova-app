# FASE 2 — Google Merchant Center: OAuth + rutas backend

## Instrucciones de eficiencia
Lee ÚNICAMENTE los archivos indicados. No explores otros archivos. No hagas refactors fuera del scope. Sé quirúrgico y preciso.

---

## Contexto
El modelo `GoogleAccount.js` ya tiene los campos Merchant agregados (Fase 1 completada).

Hoy `backend/routes/googleConnect.js` maneja OAuth para **Google Ads** (`PRODUCT_ADS`) y **Google Analytics 4** (`PRODUCT_GA4`) usando un patrón multi-producto. Ese patrón funciona en producción y **no debe tocarse**.

El objetivo de esta fase es extender `googleConnect.js` para agregar **Google Merchant Center** como tercer producto (`PRODUCT_MERCHANT`), reutilizando exactamente el mismo patrón.

---

## Archivos a leer antes de tocar cualquier cosa
1. `backend/routes/googleConnect.js` — leerlo completo para entender el patrón existente
2. `backend/routes/onboardingStatus.js` — solo para entender qué campos consume del status

No leas ningún otro archivo.

---

## Archivo a modificar
**Uno solo:** `backend/routes/googleConnect.js`

---

## Cambios exactos a realizar

### 1. Variables de entorno Merchant
Junto a donde se desestructuran `GOOGLE_GA4_CLIENT_ID`, etc., agrega:
```js
GOOGLE_MERCHANT_CLIENT_ID,
GOOGLE_MERCHANT_CLIENT_SECRET,
GOOGLE_MERCHANT_REDIRECT_URI,
GOOGLE_MERCHANT_CALLBACK_URL,
```

### 2. Constante de producto
Junto a `PRODUCT_ADS` y `PRODUCT_GA4`:
```js
const PRODUCT_MERCHANT = 'merchant';
```

### 3. Extender `oauthForProduct(product)`
Agrega el caso Merchant siguiendo el mismo patrón del caso GA4:
```js
} else if (product === PRODUCT_MERCHANT) {
  clientId    = GOOGLE_MERCHANT_CLIENT_ID    || clientId;
  clientSecret = GOOGLE_MERCHANT_CLIENT_SECRET || clientSecret;
  redirectUri  = GOOGLE_MERCHANT_REDIRECT_URI || GOOGLE_MERCHANT_CALLBACK_URL || redirectUri;
}
```

### 4. Scope de Merchant
Junto a `ADS_SCOPE` y `GA_SCOPE`:
```js
const MERCHANT_SCOPE = 'https://www.googleapis.com/auth/content';
```

### 5. Helper `hasMerchantScope`
Junto a `hasAdwordsScope` y `hasGaScope`:
```js
const hasMerchantScope = (scopes = []) =>
  Array.isArray(scopes) && scopes.some((s) => String(s).includes('/auth/content'));
```

### 6. Extender `scopesForProduct(product)`
Agrega el caso Merchant:
```js
if (product === PRODUCT_MERCHANT) return [...base, MERCHANT_SCOPE];
```

### 7. Extender `getProductFromReq(req)`
Agrega detección por path y query para merchant, siguiendo el patrón de ga4:
```js
if (path.includes('/merchant') || full.includes('/merchant')) return PRODUCT_MERCHANT;
```
Y en returnTo:
```js
if (rt.includes('product=merchant') || rt.includes('merchant')) return PRODUCT_MERCHANT;
```

### 8. Helper `getMerchantTokenBundle(ga)`
Junto a `getAdsTokenBundle` y `getGa4TokenBundle`:
```js
function getMerchantTokenBundle(ga) {
  return {
    accessToken:  ga?.merchantAccessToken  || null,
    refreshToken: ga?.merchantRefreshToken || null,
    expiresAt:    ga?.merchantExpiresAt    || null,
    scopes: Array.isArray(ga?.merchantScope) && ga.merchantScope.length
      ? ga.merchantScope
      : (Array.isArray(ga?.scope) ? ga.scope : []),
  };
}
```

### 9. Extender `getFreshAccessTokenForProduct` y `buildOAuthClientForProductFromDoc`
En `getFreshAccessTokenForProduct`, agrega el caso Merchant en el bundle selector y en el `$set` de persistencia:
```js
} else if (product === PRODUCT_MERCHANT) {
  $set.merchantAccessToken = freshAccess;
  $set.merchantExpiresAt   = freshExpiry;
}
```

### 10. Helper `normMerchantId`
```js
const normMerchantId = (val = '') =>
  String(val || '').trim().replace(/^accounts\//, '').replace(/[^\d]/g, '');
```

### 11. Helper `filterSelectedMerchantsByAvailable`
```js
function filterSelectedMerchantsByAvailable(selectedMerchantIds, availableSet) {
  return (Array.isArray(selectedMerchantIds) ? selectedMerchantIds : [])
    .map(normMerchantId).filter(Boolean).filter((id) => availableSet.has(id));
}
```

### 12. Función `fetchMerchantAccounts(oauthClient)`
Agrega esta función junto a `fetchGA4Properties`:
```js
async function fetchMerchantAccounts(oauthClient) {
  const accessToken = oauthClient?.credentials?.access_token;
  if (!accessToken) throw new Error('MERCHANT_ACCESS_TOKEN_MISSING');

  const out = [];
  let pageToken = null;

  do {
    const { data } = await axios.get(
      'https://merchantapi.googleapis.com/accounts/v1beta/accounts',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { pageSize: 250, ...(pageToken ? { pageToken } : {}) },
        timeout: 30000,
      }
    );

    for (const account of Array.isArray(data?.accounts) ? data.accounts : []) {
      const merchantId = normMerchantId(account?.accountId || account?.name || '');
      if (!merchantId) continue;
      out.push({
        merchantId,
        displayName:   account?.accountName || account?.displayName || `Merchant ${merchantId}`,
        websiteUrl:    account?.homepage || account?.homepageUri || null,
        accountStatus: account?.accountStatus || account?.state || null,
        aggregatorId:  normMerchantId(account?.aggregatorId || ''),
        source: 'merchant',
      });
    }
    pageToken = data?.nextPageToken || null;
  } while (pageToken);

  const map = new Map();
  for (const a of out) map.set(a.merchantId, a);
  return Array.from(map.values()).sort((a, b) =>
    String(a.displayName || a.merchantId).localeCompare(String(b.displayName || b.merchantId))
  );
}
```

### 13. Rutas de inicio OAuth Merchant
Junto a las rutas de Ads y GA4:
```js
router.get('/merchant', requireSession, (req, res) => {
  req.query.product = PRODUCT_MERCHANT;
  return startConnect(req, res);
});
router.get('/merchant/connect', requireSession, (req, res) => {
  req.query.product = PRODUCT_MERCHANT;
  return startConnect(req, res);
});
router.get('/connect/merchant', requireSession, (req, res) => {
  req.query.product = PRODUCT_MERCHANT;
  return startConnect(req, res);
});
```

### 14. Ruta callback Merchant
Junto a las callbacks de Ads y GA4:
```js
router.get('/merchant/callback', requireSession, googleCallbackHandler);
```

### 15. Extender `googleCallbackHandler`
En el bloque donde se guardan tokens según producto, agrega el caso Merchant **sin tocar los casos Ads y GA4**:
```js
} else if (productFromState === PRODUCT_MERCHANT) {
  if (refreshToken) ga.merchantRefreshToken = refreshToken;
  ga.merchantAccessToken  = accessToken;
  ga.merchantExpiresAt    = expiresAt;
  ga.merchantConnectedAt  = new Date();
  const existing = Array.isArray(ga.merchantScope) ? ga.merchantScope : [];
  ga.merchantScope = normalizeScopes([...existing, ...grantedScopes]);
  ga.connectedMerchant = true;
}
```

Después del save, agrega el bloque de discovery Merchant (solo si `shouldDoMerchant`):
```js
const shouldDoMerchant = productFromState === PRODUCT_MERCHANT;
const merchantHasScope   = hasMerchantScope(ga.merchantScope || []);
const merchantHasRefresh = !!(ga.merchantRefreshToken || ga.merchantAccessToken);

if (shouldDoMerchant && merchantHasScope && merchantHasRefresh) {
  try {
    const merchantClient   = await buildOAuthClientForProductFromDoc(ga, PRODUCT_MERCHANT);
    const merchantAccounts = await fetchMerchantAccounts(merchantClient);

    ga.merchantAccounts = merchantAccounts;
    const availableIds  = new Set(merchantAccounts.map((a) => normMerchantId(a.merchantId)).filter(Boolean));
    const kept          = filterSelectedMerchantsByAvailable(ga.selectedMerchantIds, availableIds);

    if (merchantAccounts.length === 1) {
      const onlyId = normMerchantId(merchantAccounts[0].merchantId);
      ga.selectedMerchantIds = onlyId ? [onlyId] : [];
      ga.defaultMerchantId   = onlyId || null;
    } else {
      ga.selectedMerchantIds = kept;
      ga.defaultMerchantId   = kept.length ? kept[0] : null;
    }

    ga.lastMerchantDiscoveryError = null;
    ga.lastMerchantDiscoveryLog   = { discoveredAt: new Date().toISOString(), count: merchantAccounts.length };
    ga.updatedAt = new Date();
    await ga.save();
  } catch (e) {
    const reason = e?.response?.data || e?.message || 'MERCHANT_DISCOVERY_FAILED';
    ga.lastMerchantDiscoveryError = String(typeof reason === 'string' ? reason : JSON.stringify(reason)).slice(0, 4000);
    ga.updatedAt = new Date();
    await ga.save();
  }
}
```

En el redirect final del callback, agrega Merchant a la lógica de `needsSelector`:
```js
const selMerchant   = Array.isArray(freshGa?.selectedMerchantIds)
  ? freshGa.selectedMerchantIds.map(normMerchantId).filter(Boolean) : [];
const merchantCount = Array.isArray(freshGa?.merchantAccounts) ? freshGa.merchantAccounts.length : 0;

// Agrega esta condición al needsSelector existente:
|| (shouldDoMerchant && merchantCount > 1 && selMerchant.length === 0)
```
Y en los query params del redirect:
```js
if (productFromState) returnTo = appendQuery(returnTo, 'product', productFromState);
```

### 16. Extender `/status`
En el endpoint `GET /status`, agrega los campos Merchant al `res.json(...)` final, junto a los de Ads y GA4:
```js
connectedMerchant,
merchantAccounts,
defaultMerchantId:        defaultMerchantIdSafe,
selectedMerchantIds,
requiredSelectionMerchant,
merchantScopeOk,
merchantExpiresAt:        ga?.merchantExpiresAt || null,
lastMerchantDiscoveryError: ga?.lastMerchantDiscoveryError || null,
```
Y las variables necesarias para construir esos valores, siguiendo el mismo patrón que Ads y GA4.

### 17. Preview disconnect Merchant
```js
router.get('/merchant/disconnect/preview', requireSession, async (req, res) => {
  try {
    return res.json({ ok: true, auditsToDelete: 0, breakdown: { merchant: 0 } });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'PREVIEW_ERROR' });
  }
});
```

### 18. GET `/merchant/accounts`
```js
router.get('/merchant/accounts', requireSession, async (req, res) => {
  try {
    const q  = { $or: [{ user: req.user._id }, { userId: req.user._id }] };
    const ga = await GoogleAccount.findOne(q)
      .select('+merchantRefreshToken +merchantAccessToken +merchantScope merchantAccounts selectedMerchantIds defaultMerchantId lastMerchantDiscoveryError')
      .lean();

    if (!ga || (!ga.merchantRefreshToken && !ga.merchantAccessToken)) {
      return res.json({ ok: true, merchantAccounts: [], selectedMerchantIds: [], defaultMerchantId: null });
    }

    if (!hasMerchantScope(ga.merchantScope || [])) {
      return res.status(428).json({ ok: false, error: 'MERCHANT_SCOPE_MISSING' });
    }

    let merchantAccounts = Array.isArray(ga.merchantAccounts) ? ga.merchantAccounts : [];
    const forceRefresh   = req.query.refresh === '1';

    if (forceRefresh || !merchantAccounts.length) {
      try {
        const fullGa       = await GoogleAccount.findOne(q);
        const client       = await buildOAuthClientForProductFromDoc(fullGa, PRODUCT_MERCHANT);
        merchantAccounts   = await fetchMerchantAccounts(client);
        const availableIds = new Set(merchantAccounts.map((a) => normMerchantId(a.merchantId)).filter(Boolean));
        const kept         = filterSelectedMerchantsByAvailable(fullGa.selectedMerchantIds, availableIds);

        fullGa.merchantAccounts          = merchantAccounts;
        fullGa.selectedMerchantIds       = kept;
        fullGa.lastMerchantDiscoveryError = null;
        fullGa.updatedAt                 = new Date();
        await fullGa.save();
      } catch (e) {
        console.warn('[googleConnect] merchant/accounts lazy refresh failed:', e?.message);
      }
    }

    const availableIds      = new Set(merchantAccounts.map((a) => normMerchantId(a.merchantId)).filter(Boolean));
    const selectedMerchantIds = (ga.selectedMerchantIds || []).map(normMerchantId).filter((id) => availableIds.has(id));
    const defaultMerchantId   = ga.defaultMerchantId ? normMerchantId(ga.defaultMerchantId) : (merchantAccounts[0]?.merchantId || null);

    return res.json({ ok: true, merchantAccounts, selectedMerchantIds, defaultMerchantId });
  } catch (err) {
    console.error('[googleConnect] merchant/accounts error:', err);
    return res.status(500).json({ ok: false, error: 'MERCHANT_ACCOUNTS_ERROR' });
  }
});
```

### 19. POST `/merchant/selection`
```js
router.post('/merchant/selection', requireSession, express.json(), async (req, res) => {
  try {
    const ids = req.body?.merchantIds;
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ ok: false, error: 'merchantIds[] requerido' });
    }

    const q   = { $or: [{ user: req.user._id }, { userId: req.user._id }] };
    const doc = await GoogleAccount.findOne(q).select('_id merchantAccounts defaultMerchantId selectedMerchantIds');
    if (!doc) return res.status(404).json({ ok: false, error: 'NO_GOOGLEACCOUNT' });

    const available = new Set((doc.merchantAccounts || []).map((a) => normMerchantId(a.merchantId)).filter(Boolean));
    const selected  = ids.map(normMerchantId).filter(Boolean).filter((id) => available.has(id));
    if (!selected.length) return res.status(400).json({ ok: false, error: 'NO_VALID_MERCHANT_IDS' });

    const nextDefault = selected.includes(normMerchantId(doc.defaultMerchantId || '')) ? normMerchantId(doc.defaultMerchantId) : selected[0];

    await GoogleAccount.updateOne({ _id: doc._id }, {
      $set: { selectedMerchantIds: selected, defaultMerchantId: nextDefault, updatedAt: new Date() },
    });

    await User.updateOne({ _id: req.user._id }, {
      $set: { selectedMerchantIds: selected, 'preferences.googleMerchant.selectedMerchantIds': selected },
    });

    return res.json({ ok: true, selectedMerchantIds: selected, defaultMerchantId: nextDefault });
  } catch (e) {
    console.error('[googleConnect] merchant/selection error:', e);
    return res.status(500).json({ ok: false, error: 'MERCHANT_SELECTION_ERROR' });
  }
});
```

### 20. POST `/merchant/disconnect`
```js
router.post('/merchant/disconnect', requireSession, async (req, res) => {
  try {
    const q  = { $or: [{ user: req.user._id }, { userId: req.user._id }] };
    const ga = await GoogleAccount.findOne(q).select('+merchantRefreshToken +merchantAccessToken connectedAds connectedGa4');
    if (!ga) return res.status(404).json({ ok: false, error: 'NO_GOOGLEACCOUNT' });

    await revokeGoogleTokenBestEffort({ refreshToken: ga.merchantRefreshToken, accessToken: ga.merchantAccessToken });

    await GoogleAccount.updateOne({ _id: ga._id }, {
      $set: {
        merchantAccessToken:       null,
        merchantRefreshToken:      null,
        merchantScope:             [],
        merchantExpiresAt:         null,
        merchantConnectedAt:       null,
        merchantAccounts:          [],
        selectedMerchantIds:       [],
        defaultMerchantId:         null,
        connectedMerchant:         false,
        lastMerchantDiscoveryError: null,
        updatedAt:                 new Date(),
      },
    });

    const stillConnected = !!(ga.connectedAds || ga.connectedGa4);
    if (!stillConnected) {
      await User.updateOne({ _id: req.user._id }, { $set: { googleConnected: false } });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[googleConnect] merchant/disconnect error:', err);
    return res.status(500).json({ ok: false, error: 'MERCHANT_DISCONNECT_ERROR' });
  }
});
```

### 21. Asegurar `module.exports = router` al final del archivo

---

## Reglas estrictas
- **NO modifiques** ningún bloque existente de Ads ni GA4.
- **NO cambies** `startConnect`, `buildAuthUrl`, `revokeGoogleTokenBestEffort` ni `googleCallbackHandler` en sus partes de Ads/GA4 — solo extiéndelos.
- **NO toques** ningún otro archivo fuera de `backend/routes/googleConnect.js`.
- Si un cambio ya existe en el archivo (de trabajo previo), verifica que coincida con esta spec y corrígelo si hay diferencia sin alterar Ads/GA4.
- Sigue el mismo estilo, naming e indentación del archivo.

---

## Verificación esperada al terminar
1. Sintaxis válida — el archivo no debe tener errores.
2. Rutas presentes: `GET /merchant`, `GET /merchant/connect`, `GET /connect/merchant`, `GET /merchant/callback`, `GET /merchant/accounts`, `POST /merchant/selection`, `POST /merchant/disconnect`, `GET /merchant/disconnect/preview`.
3. El callback guarda tokens en `merchantAccessToken/merchantRefreshToken` (no en `accessToken`).
4. Discovery de cuentas Merchant ocurre post-callback solo si `productFromState === 'merchant'`.
5. `needsSelector` incluye condición Merchant.
6. Redirect final incluye `product=merchant` cuando aplica.
7. `module.exports = router` presente al final.
8. Ningún campo ni lógica de Ads o GA4 fue modificado.
