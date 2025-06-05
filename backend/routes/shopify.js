// ─────────────────────────────────────────────────────────────────
//           RUTA ORIGINAL: backend/routes/shopify.js
// ─────────────────────────────────────────────────────────────────
/* ---------- /callback ---------- */
router.get('/callback', async (req, res) => {
  console.log('🔥 Entró a /callback con query:', req.query);

  const { shop, hmac, code, state } = req.query;

  if (!shop || !hmac || !code || !state) {
    console.warn('⚠️ Parámetros faltantes en OAuth callback:', req.query);
    return res.redirect('/onboarding?error=missing_params');
  }

  // Verificamos que el state coincida con el que guardamos en session.shopifyState
  if (state !== req.session.shopifyState) {
    console.warn('⚠️ Estado inválido en OAuth callback:', {
      recibidostate: state,
      sesionState: req.session.shopifyState
    });
    return res.redirect('/onboarding?error=invalid_state');
  }

  // Validación HMAC (no recortada aquí, pero ya estaba funcionando)

  try {
    // Intercambiamos 'code' por access_token
    const tokenRes = await axios.post(
      `https://${shop}/admin/oauth/access_token`,
      {
        client_id: SHOPIFY_API_KEY,
        client_secret: SHOPIFY_API_SECRET,
        code,
      },
      { headers: { 'Content-Type': 'application/json' } }
    );

    const accessToken = tokenRes.data.access_token;
    // Extraemos userId que almacenamos en session.shopifyState (nonce_userId)
    const userId = state.split('_').pop();

    // Generamos el hash de scopes, etc. (solo para mostrar)
    const scopeHash = crypto
      .createHash('sha256')
      .update(SCOPES)
      .digest('hex');
    const scopeHashUpdatedAt = Date.now();

    // ─────────────────────────────────────────────────────────────────
    //  Aquí es donde **sí actualizamos Mongo** para que shopifyConnected = true
    await User.findByIdAndUpdate(userId, {
      shop,
      shopifyAccessToken: accessToken,
      shopifyConnected: true,
      shopifyScopeHash: scopeHash,
      shopifyScopeHashUpdatedAt: scopeHashUpdatedAt
    });
    console.log(`✅ Shopify conectado para usuario ${userId}`);
    // ─────────────────────────────────────────────────────────────────

    // Generamos un JWT para que el front-end (onboarding.js) lo reciba.
    const payload = {
      shop,
      shopifyScopeHash: scopeHash,
    };
    const tokenJwt = jwt.sign(payload, SHOPIFY_API_SECRET);

    // Finalmente, redirigimos a la página de onboarding con el shopifyToken
    return res.redirect(`/onboarding?shopifyToken=${tokenJwt}`);
  } catch (err) {
    console.error('❌ Error al intercambiar token:', err.response?.data || err);
    return res.redirect('/onboarding?error=token_exchange_failed');
  }
});
