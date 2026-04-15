// AdRay Tracking Pixel - v2.0 (Universal)
// Usage: <script src="https://cdn.adray.io/pixel.js" data-account-id="acct_YOUR_ID"></script>
(function() {
  const ADRAY_ENDPOINT = "https://adray-app-staging-german.onrender.com/collect";
  const EVENT_TTL_MS = 2000;
  const ADRAY_LAST_CART_VALUE_KEY = '__adray_last_cart_value_v1';
  const sentEventMap = new Map();
  
  // Helpers
  function getCookie(name) {
    const value = "; " + document.cookie;
    const parts = value.split("; " + name + "=");
    if (parts.length === 2) return parts.pop().split(";").shift();
    return null;
  }

  function setCookie(name, value, maxAgeSeconds) {
    try {
      document.cookie = name + "=" + value + "; path=/; max-age=" + maxAgeSeconds + "; SameSite=Lax";
    } catch (_) {}
  }
  
  function getQueryParam(param) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(param);
  }

  function safeStorageGet(storage, key) {
    try {
      return storage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  function safeStorageSet(storage, key, value) {
    try {
      storage.setItem(key, value);
    } catch (_) {}
  }

  function safeStorageRemove(storage, key) {
    try {
      storage.removeItem(key);
    } catch (_) {}
  }

  function safeJsonParse(value, fallback) {
    if (typeof value !== 'string' || !value.trim()) return fallback;
    try {
      return JSON.parse(value);
    } catch (_) {
      return fallback;
    }
  }

  function generateId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
      }
    } catch (_) {}
    return 'adray_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
  }

  function getOrCreateBrowserId() {
    var key = '__adray_browser_id';
    var legacyKey = '__adray_visitor_id';
    var existing = safeStorageGet(window.localStorage, key)
      || safeStorageGet(window.localStorage, legacyKey)
      || getCookie(key)
      || getCookie(legacyKey);

    var id = existing || generateId();

    safeStorageSet(window.localStorage, key, id);
    safeStorageSet(window.localStorage, legacyKey, id);
    document.cookie = key + "=" + id + "; path=/; max-age=63072000; SameSite=Lax";
    document.cookie = legacyKey + "=" + id + "; path=/; max-age=63072000; SameSite=Lax";

    return id;
  }

  function getOrCreateSessionId() {
    var key = '__adray_session_id';
    var existing = safeStorageGet(window.sessionStorage, key);
      
      // Fallback to cookie
      if (!existing) {
        var match = document.cookie.match(new RegExp('(^| )' + key + '=([^;]+)'));
        if (match) existing = match[2];
      }

      var id = existing || generateId();
      
      safeStorageSet(window.sessionStorage, key, id);
      document.cookie = key + "=" + id + "; path=/; max-age=1800; SameSite=Lax";
      
      return id;
  }

  var ADRAY_UTM_BROWSER_HISTORY_KEY = '__adray_utm_browser_history_v1';
  var ADRAY_UTM_SESSION_HISTORY_KEY = '__adray_utm_session_history_v1';
  var ADRAY_UTM_BROWSER_COOKIE = '__adray_utm_browser_history';
  var ADRAY_UTM_SESSION_COOKIE = '__adray_utm_session_history';
  var ADRAY_UTM_ENTRY_COOKIE = '__adray_utm_entry_url';
  var ADRAY_UTM_BROWSER_LIMIT = 6;
  var ADRAY_UTM_SESSION_LIMIT = 4;
  var ADRAY_UTM_COOKIE_LIMIT = 4;
  var ADRAY_UTM_MAX_URL_LENGTH = 420;
  var ADRAY_UTM_COOKIE_URL_LENGTH = 240;
  var ADRAY_UTM_QUERY_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'ttclid', 'ga4_session_source'];

  function truncateText(value, maxLength) {
    var text = String(value || '').trim();
    if (!text || text.length <= maxLength) return text;
    return text.slice(0, maxLength);
  }

  function sanitizeTrackedUrl(url, maxLength) {
    var raw = String(url || '').trim();
    if (!raw) return null;
    try {
      var parsed = new URL(raw, window.location.origin);
      parsed.hash = '';
      return truncateText(parsed.toString(), maxLength || ADRAY_UTM_MAX_URL_LENGTH) || null;
    } catch (_) {
      return truncateText(raw.split('#')[0], maxLength || ADRAY_UTM_MAX_URL_LENGTH) || null;
    }
  }

  function parseTrackedUrl(url) {
    try {
      return new URL(String(url || ''), window.location.origin);
    } catch (_) {
      return null;
    }
  }

  function hasTrackedUtmSignals(url) {
    var parsed = parseTrackedUrl(url);
    if (!parsed) return false;
    return ADRAY_UTM_QUERY_KEYS.some(function(key) {
      return parsed.searchParams.has(key) && parsed.searchParams.get(key);
    });
  }

  function readHistoryFromStorage(storage, key) {
    var parsed = safeJsonParse(safeStorageGet(storage, key), []);
    return Array.isArray(parsed) ? parsed : [];
  }

  function readHistoryFromCookie(name) {
    var cookieValue = getCookie(name);
    if (!cookieValue) return [];
    var decoded = cookieValue;
    try {
      decoded = decodeURIComponent(cookieValue);
    } catch (_) {}
    var parsed = safeJsonParse(decoded, []);
    return Array.isArray(parsed) ? parsed : [];
  }

  function normalizeTrackedHistoryEntry(entry, fallbackSessionId) {
    if (!entry || typeof entry !== 'object') return null;

    var rawUrl = entry.url || entry.page_url || entry.pageUrl || entry.u || '';
    var url = sanitizeTrackedUrl(rawUrl, ADRAY_UTM_MAX_URL_LENGTH);
    if (!url || !hasTrackedUtmSignals(url)) return null;

    var parsed = parseTrackedUrl(url);
    var searchParams = parsed ? parsed.searchParams : new URLSearchParams();
    var fbclid = String(entry.fbclid || searchParams.get('fbclid') || '').trim();
    var gclid = String(entry.gclid || searchParams.get('gclid') || '').trim();
    var ttclid = String(entry.ttclid || searchParams.get('ttclid') || '').trim();

    return {
      session_id: String(entry.session_id || entry.sessionId || fallbackSessionId || '').trim() || null,
      captured_at: String(entry.captured_at || entry.capturedAt || entry.ts || new Date().toISOString()).trim(),
      url: url,
      utm_source: String(entry.utm_source || entry.utmSource || searchParams.get('utm_source') || '').trim() || null,
      utm_medium: String(entry.utm_medium || entry.utmMedium || searchParams.get('utm_medium') || '').trim() || null,
      utm_campaign: String(entry.utm_campaign || entry.utmCampaign || searchParams.get('utm_campaign') || '').trim() || null,
      utm_content: String(entry.utm_content || entry.utmContent || searchParams.get('utm_content') || '').trim() || null,
      utm_term: String(entry.utm_term || entry.utmTerm || searchParams.get('utm_term') || '').trim() || null,
      ga4_session_source: String(entry.ga4_session_source || entry.ga4SessionSource || searchParams.get('ga4_session_source') || '').trim() || null,
      fbclid: fbclid || null,
      gclid: gclid || null,
      ttclid: ttclid || null
    };
  }

  function buildTrackedHistoryEntry(url, sessionId) {
    var sanitizedUrl = sanitizeTrackedUrl(url, ADRAY_UTM_MAX_URL_LENGTH);
    if (!sanitizedUrl || !hasTrackedUtmSignals(sanitizedUrl)) return null;
    return normalizeTrackedHistoryEntry({
      url: sanitizedUrl,
      session_id: sessionId,
      captured_at: new Date().toISOString()
    }, sessionId);
  }

  function dedupeTrackedHistory(entries, limit) {
    var map = new Map();
    (Array.isArray(entries) ? entries : []).forEach(function(item) {
      var normalized = normalizeTrackedHistoryEntry(item);
      if (!normalized) return;
      var key = (normalized.session_id || 'global') + '::' + normalized.url;
      map.set(key, normalized);
    });

    return Array.from(map.values())
      .sort(function(a, b) {
        return new Date(a.captured_at || 0).getTime() - new Date(b.captured_at || 0).getTime();
      })
      .slice(-Math.max(1, limit || ADRAY_UTM_BROWSER_LIMIT));
  }

  function toCookieHistory(entries) {
    return dedupeTrackedHistory(entries, ADRAY_UTM_COOKIE_LIMIT).map(function(entry) {
      return {
        session_id: entry.session_id || null,
        captured_at: entry.captured_at || null,
        url: sanitizeTrackedUrl(entry.url, ADRAY_UTM_COOKIE_URL_LENGTH),
        utm_source: entry.utm_source || null,
        utm_medium: entry.utm_medium || null,
        utm_campaign: entry.utm_campaign || null,
        utm_content: entry.utm_content || null,
        utm_term: entry.utm_term || null,
        ga4_session_source: entry.ga4_session_source || null,
        fbclid: entry.fbclid || null,
        gclid: entry.gclid || null,
        ttclid: entry.ttclid || null
      };
    }).filter(function(entry) {
      return entry.url;
    });
  }

  function syncTrackedHistoryCookies(browserHistory, sessionHistory) {
    var browserCookieHistory = toCookieHistory(browserHistory);
    var sessionCookieHistory = toCookieHistory(sessionHistory);
    var entryUrl = sessionCookieHistory.length ? sessionCookieHistory[0].url : null;

    setCookie(ADRAY_UTM_BROWSER_COOKIE, encodeURIComponent(JSON.stringify(browserCookieHistory)), 7776000);
    setCookie(ADRAY_UTM_SESSION_COOKIE, encodeURIComponent(JSON.stringify(sessionCookieHistory)), 2592000);
    if (entryUrl) {
      setCookie(ADRAY_UTM_ENTRY_COOKIE, encodeURIComponent(entryUrl), 2592000);
    }
  }

  function getTrackedBrowserHistory() {
    var fromStorage = readHistoryFromStorage(window.localStorage, ADRAY_UTM_BROWSER_HISTORY_KEY);
    if (fromStorage.length) return dedupeTrackedHistory(fromStorage, ADRAY_UTM_BROWSER_LIMIT);
    return dedupeTrackedHistory(readHistoryFromCookie(ADRAY_UTM_BROWSER_COOKIE), ADRAY_UTM_BROWSER_LIMIT);
  }

  function getTrackedSessionHistory() {
    var fromStorage = readHistoryFromStorage(window.sessionStorage, ADRAY_UTM_SESSION_HISTORY_KEY);
    if (fromStorage.length) return dedupeTrackedHistory(fromStorage, ADRAY_UTM_SESSION_LIMIT);
    return dedupeTrackedHistory(readHistoryFromCookie(ADRAY_UTM_SESSION_COOKIE), ADRAY_UTM_SESSION_LIMIT);
  }

  function getTrackedEntryUrl() {
    var sessionHistory = getTrackedSessionHistory();
    if (sessionHistory.length && sessionHistory[0].url) return sessionHistory[0].url;
    var cookieValue = getCookie(ADRAY_UTM_ENTRY_COOKIE);
    if (!cookieValue) return null;
    try {
      return sanitizeTrackedUrl(decodeURIComponent(cookieValue), ADRAY_UTM_MAX_URL_LENGTH);
    } catch (_) {
      return sanitizeTrackedUrl(cookieValue, ADRAY_UTM_MAX_URL_LENGTH);
    }
  }

  function persistTrackedUtmHistory() {
    var sessionId = getOrCreateSessionId();
    var browserHistory = getTrackedBrowserHistory();
    var sessionHistory = getTrackedSessionHistory();
    var currentEntry = buildTrackedHistoryEntry(window.location.href, sessionId);

    if (currentEntry) {
      browserHistory = dedupeTrackedHistory(browserHistory.concat([currentEntry]), ADRAY_UTM_BROWSER_LIMIT);
      sessionHistory = dedupeTrackedHistory(sessionHistory.concat([currentEntry]), ADRAY_UTM_SESSION_LIMIT);
      safeStorageSet(window.localStorage, ADRAY_UTM_BROWSER_HISTORY_KEY, JSON.stringify(browserHistory));
      safeStorageSet(window.sessionStorage, ADRAY_UTM_SESSION_HISTORY_KEY, JSON.stringify(sessionHistory));
    }

    syncTrackedHistoryCookies(browserHistory, sessionHistory);
  }

  function buildTrackedHistoryContext() {
    var sessionHistory = getTrackedSessionHistory();
    var browserHistory = getTrackedBrowserHistory();
    var entryUrl = getTrackedEntryUrl();

    var context = {};
    if (entryUrl) context.utm_entry_url = entryUrl;
    if (sessionHistory.length) context.utm_session_history = sessionHistory;
    if (browserHistory.length) context.utm_browser_history = browserHistory;
    return context;
  }

  function persistAttributionParams() {
    var keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'ttclid', 'wbraid', 'gbraid', 'msclkid', 'fbc', 'ga4_session_source'];
    var changed = false;

    keys.forEach(function(key) {
      var incoming = getQueryParam(key);
      if (incoming) {
        safeStorageSet(window.localStorage, '__adray_attr_' + key, incoming);
        changed = true;
      }
    });

    if (changed) {
      safeStorageSet(window.localStorage, '__adray_attr_updated_at', String(Date.now()));
    }

    persistTrackedUtmHistory();
  }

  function getAttributionParam(key) {
    var fromQuery = getQueryParam(key);
    if (fromQuery) return fromQuery;
    return safeStorageGet(window.localStorage, '__adray_attr_' + key);
  }

  function getLandingPageUrl() {
    try {
      const key = '__adray_landing_page_url';
      const existing = window.sessionStorage.getItem(key);
      if (existing) return existing;
      const current = window.location.href;
      window.sessionStorage.setItem(key, current);
      return current;
    } catch (_) {
      return window.location.href;
    }
  }

  function normalizeIdentityValue(kind, value) {
    if (value == null) return null;
    var raw = String(value).trim();
    if (!raw) return null;

    if (kind === 'email') {
      var lower = raw.toLowerCase();
      return /.+@.+\..+/.test(lower) ? lower : null;
    }

    if (kind === 'phone') {
      var digits = raw.replace(/\D+/g, '');
      return digits.length >= 7 ? digits : null;
    }

    return null;
  }

  function toHexString(bytes) {
    return Array.prototype.map.call(bytes, function(b) {
      return b.toString(16).padStart(2, '0');
    }).join('');
  }

  function sha256Hex(value) {
    if (!value || !window.crypto || !window.crypto.subtle || typeof TextEncoder === 'undefined') {
      return Promise.resolve(null);
    }

    try {
      var input = new TextEncoder().encode(value);
      return window.crypto.subtle.digest('SHA-256', input).then(function(buffer) {
        return toHexString(new Uint8Array(buffer));
      }).catch(function() {
        return null;
      });
    } catch (_) {
      return Promise.resolve(null);
    }
  }

  function detectCheckoutIdentityFieldType(el) {
    if (!el) return null;

    var id = String(el.id || '').toLowerCase();
    var name = String(el.name || '').toLowerCase();
    var type = String(el.type || '').toLowerCase();

    var isEmail =
      type === 'email' ||
      /email/.test(id) ||
      /email/.test(name) ||
      name === 'billing_email' ||
      name === 'contact[email]';

    if (isEmail) return 'email';

    var isPhone =
      type === 'tel' ||
      /phone/.test(id) ||
      /phone/.test(name) ||
      name === 'billing_phone' ||
      name === 'contact[phone]';

    if (isPhone) return 'phone';
    return null;
  }

  function shouldTrackCheckoutIdentity() {
    return detectPlatform() === 'woocommerce' && detectPageType() === 'checkout';
  }

  function trackCheckoutIdentityField(el) {
    if (!shouldTrackCheckoutIdentity()) return;
    var kind = detectCheckoutIdentityFieldType(el);
    if (!kind) return;

    var normalized = normalizeIdentityValue(kind, el.value);
    if (!normalized) return;

    sha256Hex(normalized).then(function(hash) {
      if (!hash) return;

      var sentKey = '__adray_' + kind + '_hash_blur';
      var lastSent = safeStorageGet(window.sessionStorage, sentKey);
      if (lastSent === hash) return;

      safeStorageSet(window.sessionStorage, sentKey, hash);

      var identityPayload = {
        checkout_token: getCookie('woocommerce_cart_hash') || null,
        identity_stage: 'checkout_blur',
        identity_field: kind
      };

      if (kind === 'email') identityPayload.email_hash = hash;
      if (kind === 'phone') identityPayload.phone_hash = hash;

      sendEvent('identity_signal', identityPayload);
    });
  }

  function sendCheckoutIdentityFromUserContext() {
    if (!shouldTrackCheckoutIdentity()) return;

    var identity = getUserIdentityContext();
    if (!identity) return;

    [
      { kind: 'email', value: identity.email },
      { kind: 'phone', value: identity.phone }
    ].forEach(function(item) {
      var normalized = normalizeIdentityValue(item.kind, item.value);
      if (!normalized) return;

      sha256Hex(normalized).then(function(hash) {
        if (!hash) return;

        var sentKey = '__adray_' + item.kind + '_hash_prefill';
        var lastSent = safeStorageGet(window.sessionStorage, sentKey);
        if (lastSent === hash) return;

        safeStorageSet(window.sessionStorage, sentKey, hash);

        var identityPayload = {
          checkout_token: getCookie('woocommerce_cart_hash') || null,
          identity_stage: 'checkout_prefill',
          identity_field: item.kind
        };

        if (item.kind === 'email') identityPayload.email_hash = hash;
        if (item.kind === 'phone') identityPayload.phone_hash = hash;

        sendEvent('identity_signal', identityPayload);
      });
    });
  }

  function setupCheckoutIdentityBlurTracking() {
    if (!shouldTrackCheckoutIdentity()) return;

    // Send deterministic hashes from logged-in Woo profile even if checkout
    // does not render an editable email field.
    sendCheckoutIdentityFromUserContext();

    document.addEventListener('blur', function(ev) {
      var target = ev && ev.target;
      if (!(target instanceof HTMLInputElement)) return;
      trackCheckoutIdentityField(target);
    }, true);

    // Autofill can skip blur in some flows, so change captures those updates.
    document.addEventListener('change', function(ev) {
      var target = ev && ev.target;
      if (!(target instanceof HTMLInputElement)) return;
      trackCheckoutIdentityField(target);
    }, true);

    setTimeout(sendCheckoutIdentityFromUserContext, 1200);
  }

  /**
   * Returns account_id from script data attribute, or falls back to:
   * 1. Shopify shop domain (for legacy Shopify installs)
   * 2. window.AdRayAccountId (manual JS config)
   * 3. hostname as last resort
   */
  function getAccountId() {
    // Priority 1: data-account-id attribute on script tag
    const scripts = document.querySelectorAll('script[src*="adray-pixel"], script[src*="pixel.js"][data-account-id]');
    for (let script of scripts) {
      const accountId = script.getAttribute('data-account-id');
      if (accountId) return accountId;
    }
    
    // Priority 2: Global config variable
    if (window.AdRayAccountId) return window.AdRayAccountId;
    
    // Priority 3: Shopify shop domain (legacy/backward compatibility)
    if (window.Shopify && window.Shopify.shop) return window.Shopify.shop;
    
    // Priority 4: Hostname as fallback
    return window.location.hostname;
  }

  /**
   * Detects platform based on environment
   */
  function detectPlatform() {
    if (window.Shopify) return 'shopify';
    if (window.wc_add_to_cart_params || window.woocommerce_params) return 'woocommerce';
    if (window.Magento) return 'magento';
    return 'custom';
  }

  /**
   * Detects page type based on URL and DOM
   */
  function detectPageType() {
    const path = window.location.pathname;
    
    // Shopify patterns
    if (path === '/') return 'home';
    if (path.includes('/products/')) return 'product';
    if (path.includes('/collections/')) return 'collection';
    if (path.includes('/cart')) return 'cart';
    if (isOrderReceivedUrl(path)) return 'confirmation';
    if (path.includes('/checkout')) return 'checkout';
    
    // WooCommerce patterns
    if (document.body.classList.contains('home')) return 'home';
    if (document.body.classList.contains('single-product')) return 'product';
    if (document.body.classList.contains('woocommerce-shop') || 
        document.body.classList.contains('archive')) return 'collection';
    if (document.body.classList.contains('woocommerce-cart')) return 'cart';
    if (document.body.classList.contains('woocommerce-order-received')) return 'confirmation';
    if (document.body.classList.contains('woocommerce-checkout')) return 'checkout';
    
    return 'other';
  }

  function getUserIdentityContext() {
    var userData = window.adnova_user_data || null;
    if ((!userData || !userData.customer_id) && document && document.querySelector) {
      var scriptEl = document.querySelector('script[src*="adray-pixel"][data-customer-id], script[src*="pixel.js"][data-customer-id]');
      if (scriptEl) {
        userData = {
          customer_id: scriptEl.getAttribute('data-customer-id') || null,
          email: scriptEl.getAttribute('data-customer-email') || null,
          phone: scriptEl.getAttribute('data-customer-phone') || null,
          customer_name: scriptEl.getAttribute('data-customer-name') || null,
          customer_first_name: scriptEl.getAttribute('data-customer-first-name') || null,
          customer_last_name: scriptEl.getAttribute('data-customer-last-name') || null,
          billing_company: scriptEl.getAttribute('data-billing-company') || null
        };
      }
    }

    if (!userData || !userData.customer_id) return {};

    return {
      customer_id: String(userData.customer_id || '').trim() || null,
      email: userData.email || null,
      phone: userData.phone || null,
      customer_name: userData.customer_name || null,
      customer_first_name: userData.customer_first_name || null,
      customer_last_name: userData.customer_last_name || null,
      billing_company: userData.billing_company || null
    };
  }

  function sendEvent(eventName, eventData = {}) {
    const now = Date.now();
    const dedupKey = `${eventName}:${eventData.page_url || window.location.href}`;
    const last = sentEventMap.get(dedupKey) || 0;
    if (now - last < EVENT_TTL_MS) return;
    sentEventMap.set(dedupKey, now);

    var fbclid = getAttributionParam('fbclid');
    var gclid = getAttributionParam('gclid');
    var ttclid = getAttributionParam('ttclid');
    var wbraid = getAttributionParam('wbraid');
    var gbraid = getAttributionParam('gbraid');
    var msclkid = getAttributionParam('msclkid');
    var fbp = getCookie('_fbp');
    var fbc = getAttributionParam('fbc') || getCookie('_fbc');

    const payload = {
      timestamp: new Date().toISOString(),
      account_id: getAccountId(),
      session_id: getOrCreateSessionId(),
      browser_id: getOrCreateBrowserId(),
      platform: detectPlatform(),
      event_name: eventName,
      page_url: window.location.href,
      landing_page_url: getLandingPageUrl(),
      page_type: detectPageType(),
      user_agent: navigator.userAgent,
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      fbclid,
      gclid,
      ttclid,
      wbraid,
      gbraid,
      msclkid,
      click_id: gclid || wbraid || gbraid || fbclid || ttclid || msclkid || fbc || null,
      utm_source: getAttributionParam('utm_source'),
      utm_medium: getAttributionParam('utm_medium'),
      utm_campaign: getAttributionParam('utm_campaign'),
      utm_content: getAttributionParam('utm_content'),
      utm_term: getAttributionParam('utm_term'),
      ga4_session_source: getAttributionParam('ga4_session_source'),
      referrer: document.referrer,
      fbp,
      fbc,
      ...buildTrackedHistoryContext(),
      ...getUserIdentityContext(),
      ...eventData
    };

    var normalizedCartValue = normalizePositiveCartValue(payload.cart_value);
    if (normalizedCartValue !== null) {
      payload.cart_value = normalizedCartValue;
      rememberLastCartValue(normalizedCartValue);
    } else if (eventName === 'begin_checkout') {
      var rememberedCartValue = readLastCartValue(45 * 60 * 1000);
      if (rememberedCartValue !== null) {
        payload.cart_value = rememberedCartValue;
      }
    }

    const body = JSON.stringify(payload);

    if (navigator.sendBeacon && eventName === 'begin_checkout') {
      try {
        const ok = navigator.sendBeacon(
          ADRAY_ENDPOINT,
          new Blob([body], { type: 'application/json' })
        );
        if (ok) return;
      } catch (_) {}
    }

    fetch(ADRAY_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body,
      mode: "cors",
      credentials: "include", // Changed to include for cross-site cookie support
      keepalive: eventName === 'begin_checkout'
    }).catch(err => console.error("AdRay Pixel Error:", err));
  }

  function isShopifyCartAddUrl(url) {
    return typeof url === 'string' && /\/cart\/add(\.js)?(\?|$)/i.test(url);
  }

  function isWooCartAddUrl(url) {
    return typeof url === 'string' && (
      /\/wc\/store\/cart\/add-item(\?|$)/i.test(url) ||
      /[?&]wc-ajax=add_to_cart/i.test(url) ||
      /[?&]add-to-cart=\d+/i.test(url)
    );
  }

  function isCheckoutUrl(url) {
    if (typeof url !== 'string') return false;
    if (isOrderReceivedUrl(url)) return false;
    return /\/checkout(\?|$|\/)/i.test(url);
  }

  function isOrderReceivedUrl(url) {
    return typeof url === 'string' && /\/order-received(?:\/|\?|$)/i.test(url);
  }

  function resolveBeginCheckoutToken(eventData = {}) {
    return eventData.checkout_token
      || getCookie('woocommerce_cart_hash')
      || getCookie('cart')
      || getCookie('cart_sig')
      || null;
  }

  function shouldSendBeginCheckout(checkoutToken, contextUrl) {
    var url = String(contextUrl || window.location.href || '');
    if (isOrderReceivedUrl(url)) return false;

    var pathKey = '/';
    try {
      pathKey = (new URL(url, window.location.origin).pathname || '/').toLowerCase().replace(/\/+$/, '') || '/';
    } catch (_) {
      pathKey = url.toLowerCase();
    }

    var tokenKey = String(checkoutToken || '').trim();
    var dedupKey = tokenKey ? ('token:' + tokenKey) : ('path:' + pathKey);
    var storageKey = '__adray_begin_checkout_lock_v2';
    var now = Date.now();
    var lock = safeJsonParse(safeStorageGet(window.sessionStorage, storageKey), null);

    if (lock && lock.key === dedupKey) {
      var lockAge = now - Number(lock.ts || 0);
      if (Number.isFinite(lockAge) && lockAge >= 0 && lockAge < (30 * 60 * 1000)) {
        return false;
      }
    }

    safeStorageSet(window.sessionStorage, storageKey, JSON.stringify({ key: dedupKey, ts: now }));
    return true;
  }

  function trackBeginCheckout(eventData = {}, contextUrl = '') {
    var checkoutToken = resolveBeginCheckoutToken(eventData);
    if (!shouldSendBeginCheckout(checkoutToken, contextUrl)) return;

    var payload = {
      ...eventData,
      checkout_token: checkoutToken,
    };

    if (payload.cart_value === undefined || payload.cart_value === null || payload.cart_value === '') {
      payload.cart_value = detectCartValue(null, 1);
    }

    if (payload.cart_value === undefined || payload.cart_value === null || payload.cart_value === '') {
      payload.cart_value = readLastCartValue(45 * 60 * 1000);
    }

    sendEvent('begin_checkout', payload);
  }

  function parseAmountFromText(text) {
    if (!text) return null;
    var cleaned = String(text)
      .replace(/\s+/g, '')
      .replace(/[^0-9,.-]/g, '');

    if (!cleaned) return null;

    var normalized = cleaned;
    if (cleaned.indexOf(',') > -1 && cleaned.indexOf('.') > -1) {
      if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
        normalized = cleaned.replace(/\./g, '').replace(',', '.');
      } else {
        normalized = cleaned.replace(/,/g, '');
      }
    } else if (cleaned.indexOf(',') > -1) {
      normalized = cleaned.replace(',', '.');
    }

    var value = Number(normalized);
    return Number.isFinite(value) ? value : null;
  }

  function normalizePositiveCartValue(value) {
    var parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Number(parsed.toFixed(2));
  }

  function rememberLastCartValue(value) {
    var normalized = normalizePositiveCartValue(value);
    if (normalized === null) return;

    var snapshot = JSON.stringify({
      value: normalized,
      ts: Date.now()
    });

    safeStorageSet(window.sessionStorage, ADRAY_LAST_CART_VALUE_KEY, snapshot);
    safeStorageSet(window.localStorage, ADRAY_LAST_CART_VALUE_KEY, snapshot);
  }

  function readLastCartValue(maxAgeMs) {
    var maxAge = Number(maxAgeMs);
    if (!Number.isFinite(maxAge) || maxAge <= 0) maxAge = 45 * 60 * 1000;

    var sessionSnapshot = safeJsonParse(safeStorageGet(window.sessionStorage, ADRAY_LAST_CART_VALUE_KEY), null);
    var localSnapshot = safeJsonParse(safeStorageGet(window.localStorage, ADRAY_LAST_CART_VALUE_KEY), null);

    var snapshots = [sessionSnapshot, localSnapshot]
      .filter(function(item) { return item && typeof item === 'object'; })
      .map(function(item) {
        return {
          value: normalizePositiveCartValue(item.value),
          ts: Number(item.ts || 0)
        };
      })
      .filter(function(item) { return item.value !== null; })
      .sort(function(a, b) {
        return (Number(b.ts || 0) - Number(a.ts || 0));
      });

    if (!snapshots.length) return null;

    var best = snapshots[0];
    if (Number.isFinite(best.ts) && best.ts > 0) {
      var age = Date.now() - best.ts;
      if (age < 0 || age > maxAge) return null;
    }

    return best.value;
  }

  function detectWooStoreCartTotal() {
    try {
      var wpData = window.wp && window.wp.data;
      if (!wpData || typeof wpData.select !== 'function') return null;

      var cartStore = wpData.select('wc/store/cart');
      if (!cartStore || typeof cartStore.getCartData !== 'function') return null;

      var cartData = cartStore.getCartData();
      var totals = cartData && cartData.totals ? cartData.totals : null;
      if (!totals) return null;

      var rawTotal = totals.total_price;
      if (rawTotal === undefined || rawTotal === null || rawTotal === '') return null;

      var parsedTotal = Number(rawTotal);
      if (!Number.isFinite(parsedTotal)) return null;

      var minorUnit = Number(totals.currency_minor_unit);
      if (Number.isFinite(minorUnit) && minorUnit >= 0 && minorUnit <= 4) {
        parsedTotal = parsedTotal / Math.pow(10, minorUnit);
      }

      return normalizePositiveCartValue(parsedTotal);
    } catch (_) {
      return null;
    }
  }

  function detectProductName(sourceEl = null) {
    try {
      const shopifyTitle = window.ShopifyAnalytics?.meta?.product?.title;
      if (typeof shopifyTitle === 'string' && shopifyTitle.trim()) return shopifyTitle.trim();
    } catch (_) {}

    if (sourceEl && sourceEl.closest) {
      const containers = [
        sourceEl.closest('[data-product_name]'),
        sourceEl.closest('[data-product-name]'),
        sourceEl.closest('[data-product-id]'),
        sourceEl.closest('[data-product_id]'),
        sourceEl.closest('.product'),
        sourceEl.closest('.product-card'),
        sourceEl.closest('.product-item'),
        sourceEl.closest('.card-product'),
        sourceEl.closest('form'),
      ].filter(Boolean);

      for (const container of containers) {
        try {
          const ownDataName = container.getAttribute?.('data-product_name') || container.getAttribute?.('data-product-name') || '';
          if (ownDataName && ownDataName.trim()) return ownDataName.trim();

          const child = container.querySelector?.('[data-product_name],[data-product-name],.product_title,.product-title,.product__title,.product-card__title,.woocommerce-loop-product__title,h1,h2,h3,a[title]');
          if (child) {
            const childDataName = child.getAttribute?.('data-product_name') || child.getAttribute?.('data-product-name') || child.getAttribute?.('title') || '';
            const childText = childDataName || child.textContent || '';
            if (typeof childText === 'string' && childText.trim()) return childText.trim();
          }
        } catch (_) {}
      }
    }

    const candidates = [
      '[data-product_name]',
      '[data-product-name]',
      'h1.product_title',
      '.product_title',
      '.product-single__title',
      '.product__title',
      'main h1',
      'h1'
    ];

    for (const selector of candidates) {
      try {
        const el = document.querySelector(selector);
        if (!el) continue;
        const dataName = el.getAttribute('data-product_name') || el.getAttribute('data-product-name') || '';
        const text = dataName || el.textContent || '';
        if (typeof text === 'string' && text.trim()) return text.trim();
      } catch (_) {}
    }

    try {
      const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content') || '';
      if (ogTitle.trim()) return ogTitle.trim();
    } catch (_) {}

    return null;
  }

  function detectProductPrice(sourceEl = null) {
    var priceSelectors = [
      '[data-product_price]',
      '[data-product-price]',
      '[data-price]',
      '.price .amount',
      '.price .woocommerce-Price-amount',
      '.product-price .amount',
      '.product__price .amount',
      '.woocommerce-Price-amount',
      '.amount'
    ];

    var containers = [];
    if (sourceEl && sourceEl.closest) {
      containers = [
        sourceEl.closest('[data-product_price]'),
        sourceEl.closest('[data-product-price]'),
        sourceEl.closest('[data-price]'),
        sourceEl.closest('.product'),
        sourceEl.closest('.product-card'),
        sourceEl.closest('.product-item'),
        sourceEl.closest('form')
      ].filter(Boolean);
    }

    function detectFromNode(node) {
      if (!node) return null;
      try {
        var directData = node.getAttribute && (
          node.getAttribute('data-product_price') ||
          node.getAttribute('data-product-price') ||
          node.getAttribute('data-price')
        );
        var directPrice = parseAmountFromText(directData || '');
        if (directPrice !== null) return directPrice;
      } catch (_) {}

      for (var i = 0; i < priceSelectors.length; i++) {
        try {
          var candidate = node.matches && node.matches(priceSelectors[i]) ? node : node.querySelector(priceSelectors[i]);
          if (!candidate) continue;
          var dataValue = candidate.getAttribute && (
            candidate.getAttribute('data-product_price') ||
            candidate.getAttribute('data-product-price') ||
            candidate.getAttribute('data-price')
          );
          var textValue = dataValue || candidate.textContent || '';
          var parsed = parseAmountFromText(textValue);
          if (parsed !== null) return parsed;
        } catch (_) {}
      }

      return null;
    }

    for (var c = 0; c < containers.length; c++) {
      var containerPrice = detectFromNode(containers[c]);
      if (containerPrice !== null) return containerPrice;
    }

    for (var j = 0; j < priceSelectors.length; j++) {
      try {
        var el = document.querySelector(priceSelectors[j]);
        var parsed = detectFromNode(el);
        if (parsed !== null) return parsed;
      } catch (_) {}
    }

    return null;
  }

  function detectCartValue(sourceEl = null, quantity = 1) {
    var cartTotalSelectors = [
      '.cart_totals .order-total .amount',
      '.cart_totals .cart-subtotal .amount',
      '.woocommerce-checkout-review-order-table .order-total .woocommerce-Price-amount',
      '.woocommerce-checkout-review-order-table .order-total .amount',
      '#order_review .order-total .woocommerce-Price-amount',
      '#order_review .order-total .amount',
      '.shop_table .order-total .woocommerce-Price-amount',
      '.shop_table .order-total .amount',
      '.order-total .woocommerce-Price-amount',
      '[data-cart-total]',
      '[data-order-total]',
      '.woocommerce-mini-cart__total .amount',
      '.widget_shopping_cart_content .total .amount',
      '.mini-cart-total .amount',
      '.site-header-cart .amount'
    ];

    for (var i = 0; i < cartTotalSelectors.length; i++) {
      try {
        var cartEl = document.querySelector(cartTotalSelectors[i]);
        if (!cartEl) continue;
        var cartRaw = null;
        if (cartEl.tagName === 'INPUT') {
          cartRaw = cartEl.value || cartEl.getAttribute('value') || null;
        }
        if (!cartRaw) {
          cartRaw = (cartEl.getAttribute && (
            cartEl.getAttribute('data-cart-total') ||
            cartEl.getAttribute('data-order-total') ||
            cartEl.getAttribute('data-total') ||
            cartEl.getAttribute('value')
          )) || null;
        }
        var cartTotal = parseAmountFromText(cartRaw || cartEl.textContent || '');
        if (cartTotal !== null) return cartTotal;
      } catch (_) {}
    }

    var cartTotalInputSelectors = [
      'input[name="cart_total"]',
      'input[name="order_total"]',
      'input[name="payment_total"]',
      'input[name="total"]',
      'input[id*="order_total"]',
      'input[id*="cart_total"]'
    ];

    for (var inputIndex = 0; inputIndex < cartTotalInputSelectors.length; inputIndex++) {
      try {
        var inputEl = document.querySelector(cartTotalInputSelectors[inputIndex]);
        if (!inputEl) continue;
        var inputRaw = inputEl.value || inputEl.getAttribute('value') || inputEl.getAttribute('data-value') || '';
        var inputTotal = parseAmountFromText(inputRaw);
        if (inputTotal !== null) return inputTotal;
      } catch (_) {}
    }

    var wooStoreTotal = detectWooStoreCartTotal();
    if (wooStoreTotal !== null) return wooStoreTotal;

    var productPrice = detectProductPrice(sourceEl);
    var normalizedQty = Number(quantity);
    if (!Number.isFinite(normalizedQty) || normalizedQty <= 0) normalizedQty = 1;
    if (productPrice !== null) return Number((productPrice * normalizedQty).toFixed(2));

    return null;
  }

  function getProductContext(sourceEl = null) {
    let productId = null;
    let variantId = null;
    let productName = detectProductName(sourceEl);

    try {
      const shopifyMeta = window.ShopifyAnalytics?.meta?.product;
      if (shopifyMeta) {
        productId = shopifyMeta.id ? String(shopifyMeta.id) : productId;
        variantId = shopifyMeta.selectedVariantId ? String(shopifyMeta.selectedVariantId) : variantId;
        productName = shopifyMeta.title ? String(shopifyMeta.title) : productName;
      }
    } catch (_) {}

    try {
      if (!variantId) {
        const variantInput = document.querySelector('form[action*="/cart/add"] [name="id"], form[action*="cart/add"] [name="id"]');
        if (variantInput?.value) variantId = String(variantInput.value);
      }
    } catch (_) {}

    try {
      if (!productId) {
        const wcButton = document.querySelector('[data-product_id]');
        const wcId = wcButton ? wcButton.getAttribute('data-product_id') : null;
        if (wcId) productId = String(wcId);
        const wcName = wcButton ? (wcButton.getAttribute('data-product_name') || wcButton.getAttribute('data-product-name')) : null;
        if (!productName && wcName) productName = String(wcName);
      }
    } catch (_) {}

    return { product_id: productId, variant_id: variantId, product_name: productName || null };
  }

  // === PLATFORM-SPECIFIC EVENT INTERCEPTORS ===

  // 1. Send Page View immediately
  persistAttributionParams();
  sendEvent("page_view");

  // 1.1 Product page view for funnel completeness (view_item)
  if (detectPageType() === 'product') {
    const ctx = getProductContext();
    sendEvent('view_item', {
      product_id: ctx.product_id || null,
      variant_id: ctx.variant_id || null
    });
  }

  // 2. Intercept Add to Cart (multi-platform)
  const originalFetch = window.fetch;
  window.fetch = async function() {
    const response = await originalFetch.apply(this, arguments);
    const arg0 = arguments[0];
    const url = typeof arg0 === 'string' ? arg0 : (arg0 && arg0.url ? String(arg0.url) : '');
    
    // Shopify: /cart/add.js
    if (isShopifyCartAddUrl(url)) {
       try {
         const clonedRes = response.clone();
         const data = await clonedRes.json();
         sendEvent("add_to_cart", {
             product_id: data.product_id ? String(data.product_id) : null,
             variant_id: data.variant_id ? String(data.variant_id) : null,
             product_name: data.product_title || data.title || data.name || null,
             cart_value: data.price ? data.price / 100 : null
         });
       } catch (e) {}
    }

    // Shopify begin checkout (AJAX/cart endpoints)
    if (isCheckoutUrl(url)) {
      trackBeginCheckout({
        checkout_token: getCookie('cart') || getCookie('cart_sig') || null
      }, url);
    }
    
    // WooCommerce: REST + wc-ajax + add-to-cart endpoints
    if (isWooCartAddUrl(url)) {
       try {
         const clonedRes = response.clone();
         const data = await clonedRes.json();
         sendEvent("add_to_cart", {
             product_id: data.items?.[0]?.id ? String(data.items[0].id) : null,
             variant_id: data.items?.[0]?.variation_id ? String(data.items[0].variation_id) : null,
             product_name: data.items?.[0]?.name || data.items?.[0]?.title || null,
             cart_value: data.totals?.total_price ? parseFloat(data.totals.total_price) / 100 : null
         });
       } catch (e) {
         const ctx = getProductContext();
         sendEvent('add_to_cart', {
           ...ctx,
           cart_value: detectCartValue(null, 1)
         });
       }
    }
    
    return response;
  };

  // 3. WooCommerce: AJAX add to cart (fallback for classic themes)
  if (typeof jQuery !== 'undefined') {
    jQuery(document.body).on('added_to_cart', function(event, fragments, cart_hash, $button) {
      const buttonEl = $button && $button[0] ? $button[0] : null;
      const productId = $button ? $button.data('product_id') : null;
      const productName = $button ? ($button.data('product_name') || $button.data('product-name')) : null;
      const quantity = $button ? $button.data('quantity') : 1;
      sendEvent("add_to_cart", {
        product_id: productId ? String(productId) : null,
        product_name: productName ? String(productName) : (detectProductName(buttonEl) || null),
        quantity: quantity,
        cart_value: detectCartValue(buttonEl, quantity)
      });
    });
  }

  // 3.1 Shopify: XHR fallback for themes that don't use fetch
  (function patchXHR() {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url) {
      this.__adray_url = typeof url === 'string' ? url : '';
      return origOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function() {
      this.addEventListener('load', function() {
        const xhrUrl = this.__adray_url || '';
        if (isShopifyCartAddUrl(xhrUrl)) {
          sendEvent("add_to_cart", {
            cart_value: detectCartValue(null, 1)
          });
        }
        if (isWooCartAddUrl(xhrUrl)) {
          const ctx = getProductContext();
          sendEvent('add_to_cart', {
            ...ctx,
            cart_value: detectCartValue(null, 1)
          });
        }
        if (isCheckoutUrl(xhrUrl)) {
          trackBeginCheckout({
            checkout_token: getCookie('cart') || getCookie('cart_sig') || null
          }, xhrUrl);
        }
      });
      return origSend.apply(this, arguments);
    };
  })();

  // 3.2 Shopify + WooCommerce: form submit fallback (no AJAX themes)
  document.addEventListener('submit', function(ev) {
    try {
      const form = ev.target;
      if (!(form instanceof HTMLFormElement)) return;
      const action = form.getAttribute('action') || '';

      if (isShopifyCartAddUrl(action)) {
        const productId = form.querySelector('[name="id"]')?.value || null;
        const qty = Number(form.querySelector('[name="quantity"]')?.value || 1);
        sendEvent('add_to_cart', {
          product_id: productId ? String(productId) : null,
          product_name: detectProductName(form),
          quantity: Number.isFinite(qty) ? qty : 1,
          cart_value: detectCartValue(form, qty)
        });
      }

      if (isWooCartAddUrl(action) || form.querySelector('[name="add-to-cart"]')) {
        const wcProductId = form.querySelector('[name="add-to-cart"]')?.value || form.querySelector('[name="product_id"]')?.value || null;
        const wcQty = Number(form.querySelector('[name="quantity"]')?.value || 1);
        const ctx = getProductContext(form);
        sendEvent('add_to_cart', {
          product_id: wcProductId ? String(wcProductId) : (ctx.product_id || null),
          product_name: ctx.product_name || null,
          quantity: Number.isFinite(wcQty) ? wcQty : 1,
          cart_value: detectCartValue(form, wcQty)
        });
      }

      if (isCheckoutUrl(action)) {
        trackBeginCheckout({
          checkout_token: getCookie('cart') || getCookie('cart_sig') || null
        }, action);
      }
    } catch (_) {}
  }, true);

  // 3.3 Shopify + WooCommerce: click fallback
  document.addEventListener('click', function(ev) {
    try {
      const target = ev.target;
      const el = target && target.closest ? target.closest('a,button,input[type="submit"]') : null;
      if (!el) return;

      const href = el.getAttribute && el.getAttribute('href');
      const name = (el.getAttribute && el.getAttribute('name')) || '';
      const formAction = el.form ? (el.form.getAttribute('action') || '') : '';

      const likelyCheckout =
        isCheckoutUrl(href || '') ||
        isCheckoutUrl(formAction) ||
        /checkout/i.test(name) ||
        /checkout/i.test(el.id || '') ||
        /checkout/i.test(el.className || '');

      const likelyWooAddToCart =
        /add_to_cart_button|single_add_to_cart_button/i.test(el.className || '') ||
        /add-to-cart/i.test(name) ||
        /add[-_]?to[-_]?cart/i.test(el.id || '') ||
        isWooCartAddUrl(href || '') ||
        isWooCartAddUrl(formAction);

      if (likelyWooAddToCart) {
        const ctx = getProductContext(el);
        sendEvent('add_to_cart', {
          ...ctx,
          cart_value: detectCartValue(el, 1)
        });
      }

      if (likelyCheckout) {
        trackBeginCheckout({
          checkout_token: getCookie('cart') || getCookie('cart_sig') || null
        }, href || formAction || window.location.href);
      }
    } catch (_) {}
  }, true);

  // 4. Checkout page hit detection (platform-agnostic fallback).
  if (detectPageType() === 'checkout' && !isOrderReceivedUrl(window.location.pathname)) {
    trackBeginCheckout({
      checkout_token: getCookie('woocommerce_cart_hash') || getCookie('cart') || getCookie('cart_sig') || null
    }, window.location.href);
  }

  setupCheckoutIdentityBlurTracking();

  // 4.2 WooCommerce: stitch logged-in customers to the current browser session.
  function tryTrackWooLogout() {
    var currentIdentity = getUserIdentityContext();
    var lastTrackedCustomerId = safeStorageGet(window.sessionStorage, '__adray_login_customer_id');
    if (!lastTrackedCustomerId) return false;
    if (currentIdentity && currentIdentity.customer_id) return false;

    safeStorageRemove(window.sessionStorage, '__adray_login_customer_id');
    sendEvent('user_logged_out', {
      platform: 'woocommerce',
      customer_id: String(lastTrackedCustomerId).trim() || null,
      page_type: detectPageType() === 'other' ? 'account' : detectPageType(),
      logout_detected_from: 'pixel_runtime'
    });
    return true;
  }

  function tryTrackWooLogin() {
    var userData = window.adnova_user_data || null;
    var platform = detectPlatform();
    var hasWooContext = platform === 'woocommerce' || (userData && userData.customer_id);
    if (!hasWooContext) return false;

    if (!userData || !userData.customer_id) {
      safeStorageRemove(window.sessionStorage, '__adray_login_customer_id');
      return false;
    }

    var currentCustomerId = String(userData.customer_id || '').trim();
    if (!currentCustomerId) return false;

    var lastTrackedCustomerId = safeStorageGet(window.sessionStorage, '__adray_login_customer_id');
    if (lastTrackedCustomerId === currentCustomerId) return true;

    safeStorageSet(window.sessionStorage, '__adray_login_customer_id', currentCustomerId);
    sendEvent('user_logged_in', {
      platform: 'woocommerce',
      customer_id: currentCustomerId,
      email: userData.email || null,
      phone: userData.phone || null,
      customer_name: userData.customer_name || null,
      customer_first_name: userData.customer_first_name || null,
      customer_last_name: userData.customer_last_name || null,
      billing_company: userData.billing_company || null,
      page_type: detectPageType() === 'other' ? 'account' : detectPageType(),
      login_detected_from: 'pixel_runtime'
    });
    return true;
  }

  (function scheduleWooLoginDetection() {
    tryTrackWooLogout();

    // Immediate attempt
    if (tryTrackWooLogin()) return;

    // Retry for delayed contexts (cached HTML, deferred script order, async account widgets)
    var attempts = 0;
    var maxAttempts = 40; // ~20s at 500ms
    var timer = setInterval(function() {
      attempts += 1;
      tryTrackWooLogout();
      if (tryTrackWooLogin() || attempts >= maxAttempts) {
        clearInterval(timer);
      }
    }, 500);

    document.addEventListener('DOMContentLoaded', function() {
      tryTrackWooLogout();
      tryTrackWooLogin();
    }, { once: true });
    window.addEventListener('load', function() {
      tryTrackWooLogout();
      tryTrackWooLogin();
    }, { once: true });
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible') {
        tryTrackWooLogout();
        tryTrackWooLogin();
      }
    });
  })();

  // 5. WooCommerce: Purchase event on order-received (thank-you) page
  // Order data is injected by the Adnova WordPress plugin via window.adnova_order_data.
  // Falls back to URL scraping when data is not available.
  (function detectWooPurchase() {
    function parseAmountFromText(text) {
      if (!text) return null;
      var cleaned = String(text)
        .replace(/\s+/g, '')
        .replace(/[^0-9,.-]/g, '');

      if (!cleaned) return null;

      // Handle common formats: 1,234.56 and 1.234,56
      var normalized = cleaned;
      if (cleaned.indexOf(',') > -1 && cleaned.indexOf('.') > -1) {
        if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
          normalized = cleaned.replace(/\./g, '').replace(',', '.');
        } else {
          normalized = cleaned.replace(/,/g, '');
        }
      } else if (cleaned.indexOf(',') > -1) {
        normalized = cleaned.replace(',', '.');
      }

      var val = Number(normalized);
      return Number.isFinite(val) ? val : null;
    }

    function detectCurrencyFromText(text) {
      if (!text) return null;
      var t = String(text).toUpperCase();
      if (t.indexOf('MXN') !== -1 || t.indexOf('$') !== -1) return 'MXN';
      if (t.indexOf('USD') !== -1 || t.indexOf('US$') !== -1) return 'USD';
      if (t.indexOf('EUR') !== -1 || t.indexOf('€') !== -1) return 'EUR';
      return null;
    }

    function scrapeWooOrderDataFromDOM() {
      var totalSelectors = [
        '.woocommerce-order-overview__total .amount',
        '.order-total .woocommerce-Price-amount',
        '.order-total .amount',
        '.woocommerce-table--order-details tfoot .order-total .amount'
      ];

      var totalText = null;
      for (var i = 0; i < totalSelectors.length; i++) {
        var el = document.querySelector(totalSelectors[i]);
        if (el && el.textContent) {
          totalText = el.textContent.trim();
          if (totalText) break;
        }
      }

      var items = [];
      var rows = document.querySelectorAll('.woocommerce-table--order-details tbody tr');
      rows.forEach(function(row) {
        var nameEl = row.querySelector('.product-name');
        var totalEl = row.querySelector('.product-total .amount, .product-total .woocommerce-Price-amount, .amount');
        var qtyText = nameEl ? (nameEl.textContent || '') : '';
        var qtyMatch = qtyText.match(/×\s*(\d+)/);
        var qty = qtyMatch ? Number(qtyMatch[1]) : 1;
        var lineTotal = parseAmountFromText(totalEl ? totalEl.textContent : '') || 0;

        items.push({
          id: null,
          name: nameEl ? String(nameEl.textContent || '').replace(/×\s*\d+.*/, '').trim() : 'Producto',
          quantity: Number.isFinite(qty) ? qty : 1,
          line_total: lineTotal
        });
      });

      return {
        revenue: parseAmountFromText(totalText),
        currency: detectCurrencyFromText(totalText),
        items: items.length ? items : null
      };
    }

    var isOrderReceived =
      document.body.classList.contains('woocommerce-order-received') ||
      /\/order-received\//i.test(window.location.pathname);

    if (!isOrderReceived) return;

    // Prefer server-injected order data (set by Adnova plugin woocommerce_thankyou hook)
    if (window.adnova_order_data) {
      var o = window.adnova_order_data;
      sendEvent('purchase', {
        event_id: 'brw_wc_' + o.order_id,   // dedup key aligned with server-side
        order_id: o.order_id   || null,
        revenue:  o.revenue    || null,
        currency: o.currency   || null,
        items:    o.items      || null,
        checkout_token: o.checkout_token || null,
        utm_entry_url: o.utm_entry_url || null,
        utm_session_history: o.utm_session_history || null,
        utm_browser_history: o.utm_browser_history || null
      });
      return;
    }

    // Fallback: scrape order ID from URL (/order-received/12345/)
    var orderIdMatch = window.location.pathname.match(/\/order-received\/(\d+)/);
    var fallbackOrderId = orderIdMatch ? orderIdMatch[1] : null;
    var domData = scrapeWooOrderDataFromDOM();
    sendEvent('purchase', {
      order_id: fallbackOrderId,
      revenue: domData.revenue,
      currency: domData.currency,
      items: domData.items
    });
  })();

  // 6. Expose for manual triggers with enhanced API
  window.AdRay = window.AdRay || {};
  window.AdRay.track = sendEvent;
  window.AdRay.getAccountId = getAccountId;
  window.AdRay.getPlatform = detectPlatform;
  window.AdRay.version = '2.0';

  // ============================================================
  // 7. Microsoft Clarity integration (temporary infra scaffold)
  //    Provides immediate session recordings while the self-hosted
  //    rrweb pipeline is built in parallel. Will be replaced by
  //    the native recording system (Phase 2 of behavioral roadmap).
  //    To enable: set data-clarity-id="YOUR_PROJECT_ID" on the
  //    adray-pixel script tag, or define window.AdRayClarityId.
  // ============================================================
  (function initClarity() {
    // Resolve the Clarity project ID from the script tag or a global.
    var clarityId = null;
    try {
      var scripts = document.querySelectorAll(
        'script[src*="adray-pixel"], script[src*="pixel.js"][data-account-id]'
      );
      for (var i = 0; i < scripts.length; i++) {
        var cid = scripts[i].getAttribute('data-clarity-id');
        if (cid && cid.trim()) { clarityId = cid.trim(); break; }
      }
      if (!clarityId && window.AdRayClarityId) clarityId = String(window.AdRayClarityId).trim();
    } catch (_) {}

    if (!clarityId) return; // Clarity disabled — no project ID configured

    // Inject the Clarity snippet asynchronously.
    try {
      (function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src='https://www.clarity.ms/tag/'+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
      })(window, document, 'clarity', 'script', clarityId);
    } catch (_) { return; }

    // Poll until clarity() is available, then identify and tag the session.
    var waited = 0;
    var maxWait = 10000;
    var poll = setInterval(function() {
      waited += 250;
      if (waited > maxWait) { clearInterval(poll); return; }
      if (typeof window.clarity !== 'function') return;
      clearInterval(poll);

      var accountId  = getAccountId();
      var sessionId  = getOrCreateSessionId();
      var userKey    = getCookie('_adray_uid') || '';

      // Identify — links the Clarity recording to the AdRay identity graph.
      try { window.clarity('identify', userKey || sessionId, sessionId); } catch (_) {}

      // Custom tags — searchable/filterable in the Clarity dashboard.
      var tagPairs = [
        ['adray_session_id',   sessionId],
        ['adray_account_id',   accountId],
        ['adray_platform',     detectPlatform()],
        ['adray_page_type',    detectPageType()],
        ['utm_source',         getAttributionParam('utm_source')],
        ['utm_medium',         getAttributionParam('utm_medium')],
        ['utm_campaign',       getAttributionParam('utm_campaign')],
        ['has_gclid',          getAttributionParam('gclid') ? 'true' : 'false'],
        ['has_fbclid',         getAttributionParam('fbclid') ? 'true' : 'false'],
      ];
      tagPairs.forEach(function(pair) {
        try {
          if (pair[1]) window.clarity('set', pair[0], String(pair[1]));
        } catch (_) {}
      });

      // Capture the playback URL from Clarity and persist it to the session.
      // This enables the "▶ Ver grabación" button in the Session Explorer.
      // Note: clarity('metadata', cb) fires cb(playbackUrl, isNew) — only 2 guaranteed params.
      // We extract the Clarity session ID from the URL path: /player/{projectId}/{sessionId}
      try {
        window.clarity('metadata', function(playbackUrl, isNew) {
          if (!playbackUrl) return;
          var sessionIdFromUrl = null;
          try {
            var m = playbackUrl.match(/\/player\/[^\/]+\/([^\/\?#]+)/);
            sessionIdFromUrl = m ? m[1] : null;
          } catch (_) {}
          try {
            sendEvent('clarity_session_linked', {
              clarity_playback_url: playbackUrl,
              clarity_session_id:   sessionIdFromUrl,
            });
          } catch (_) {}
        });
      } catch (_) {}
    }, 250);
  })();

  // =========================================================================
  // ADRAY BRI — rrweb Recording Module
  // Lazy-loads rrweb from CDN only when add_to_cart fires.
  // Records from AddToCart onwards (not from page load) — privacy-first,
  // cost-efficient, and focused on the moments that matter.
  // =========================================================================

  var _adrayRrwebLoaded = false;
  var _adrayRrwebLoading = false;
  var _adrayRecordingId = null;
  var _adrayChunkIndex = 0;
  var _adrayChunkBuffer = [];
  var _adrayStopFn = null;
  var _adrayFlushTimer = null;
  var _ADRAY_FLUSH_MS = 4000;
  var _ADRAY_CHUNK_MAX_BYTES = 200000;
  var _ADRAY_REC_BASE = ADRAY_ENDPOINT.replace('/collect', '');
  var _ADRAY_RRWEB_CDN = _ADRAY_REC_BASE + '/static/dom-observer.min.js';

  function _adrayLoadRrweb(callback) {
    console.log('[ADRAY-REC] _adrayLoadRrweb called. loaded:', _adrayRrwebLoaded, 'loading:', _adrayRrwebLoading);
    if (_adrayRrwebLoaded) { callback(); return; }
    if (_adrayRrwebLoading) {
      window.__adray_rrweb_cbs = window.__adray_rrweb_cbs || [];
      window.__adray_rrweb_cbs.push(callback);
      return;
    }
    _adrayRrwebLoading = true;
    window.__adray_rrweb_cbs = [callback];
    var s = document.createElement('script');
    s.src = _ADRAY_RRWEB_CDN;
    console.log('[ADRAY-REC] Loading rrweb from:', s.src);
    s.async = true;
    s.onload = function() {
      console.log('[ADRAY-REC] rrweb loaded OK. window.rrweb:', !!window.rrweb, 'record:', !!(window.rrweb && window.rrweb.record));
      _adrayRrwebLoaded = true;
      _adrayRrwebLoading = false;
      (window.__adray_rrweb_cbs || []).forEach(function(cb) { try { cb(); } catch(e) { console.error('[ADRAY-REC] callback error:', e); } });
      window.__adray_rrweb_cbs = [];
    };
    s.onerror = function(e) {
      console.error('[ADRAY-REC] rrweb FAILED to load from:', s.src, e);
      _adrayRrwebLoading = false;
    };
    document.head.appendChild(s);
  }

  function _adrayFlushChunk() {
    if (!_adrayChunkBuffer.length || !_adrayRecordingId) {
      console.log('[ADRAY-REC] flush skipped — buffer:', _adrayChunkBuffer.length, 'recId:', _adrayRecordingId);
      return;
    }
    var events = _adrayChunkBuffer.splice(0, _adrayChunkBuffer.length);
    var idx = _adrayChunkIndex++;
    console.log('[ADRAY-REC] flushing chunk', idx, '—', events.length, 'events');
    var body = JSON.stringify({
      account_id: getAccountId(),
      recording_id: _adrayRecordingId,
      session_id: getOrCreateSessionId(),
      chunk_index: idx,
      events: events,
      timestamp: new Date().toISOString()
    });
    var endpoint = _ADRAY_REC_BASE + '/collect/x/buf';
    // Use sendBeacon for reliability on page unload; fallback to fetch for visibility in DevTools
    var sent = false;
    try {
      if (navigator.sendBeacon) {
        sent = navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
      }
    } catch(_) {}
    if (!sent) {
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: body
      }).then(function(r) {
        console.log('[ADRAY-REC] chunk', idx, 'sent →', r.status);
      }).catch(function(e) {
        console.error('[ADRAY-REC] chunk', idx, 'FAILED:', e.message || e);
      });
    } else {
      console.log('[ADRAY-REC] chunk', idx, 'sent via sendBeacon');
    }
  }

  function _adrayStartRecording(cartPayload) {
    console.log('[ADRAY-REC] _adrayStartRecording called. stopFn:', !!_adrayStopFn, 'rrweb:', !!window.rrweb);
    if (_adrayStopFn) { console.log('[ADRAY-REC] already recording, skip'); return; }
    if (!window.rrweb || !window.rrweb.record) { console.error('[ADRAY-REC] rrweb.record not available!'); return; }

    _adrayRecordingId = 'rec_' + generateId();
    _adrayChunkIndex = 0;
    _adrayChunkBuffer = [];
    console.log('[ADRAY-REC] starting recording:', _adrayRecordingId, 'account:', getAccountId(), 'session:', getOrCreateSessionId());

    // Notify backend: recording started
    var initUrl = _ADRAY_REC_BASE + '/collect/x/init';
    console.log('[ADRAY-REC] POST init →', initUrl);
    fetch(initUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        account_id: getAccountId(),
        recording_id: _adrayRecordingId,
        session_id: getOrCreateSessionId(),
        browser_id: getOrCreateBrowserId(),
        trigger_event: 'add_to_cart',
        cart_value: cartPayload && cartPayload.cart_value ? cartPayload.cart_value : null,
        checkout_token: cartPayload && cartPayload.checkout_token ? cartPayload.checkout_token : null,
        timestamp: new Date().toISOString()
      })
    }).then(function(r) {
      console.log('[ADRAY-REC] init →', r.status, r.ok ? 'OK' : 'ERROR');
      return r.ok ? r.json() : r.text().then(function(t) { throw new Error(t); });
    }).then(function(data) {
      console.log('[ADRAY-REC] init response:', JSON.stringify(data));
    }).catch(function(e) {
      console.error('[ADRAY-REC] init FAILED:', e.message || e);
    });

    try {
      _adrayStopFn = window.rrweb.record({
        emit: function(event) {
          _adrayChunkBuffer.push(event);
          if (JSON.stringify(_adrayChunkBuffer).length >= _ADRAY_CHUNK_MAX_BYTES) {
            _adrayFlushChunk();
          }
        },
        maskAllInputs: true,
        inlineStylesheet: true,
        inlineImages: false,
        blockSelector: '[data-adray-block]',
        sampling: {
          mousemove: 100,
          mouseInteraction: true,
          scroll: 150,
          input: 'last'
        }
      });
      console.log('[ADRAY-REC] rrweb.record() started, stopFn:', typeof _adrayStopFn);
    } catch(e) {
      console.error('[ADRAY-REC] rrweb.record() threw:', e);
      return;
    }

    _adrayFlushTimer = setInterval(_adrayFlushChunk, _ADRAY_FLUSH_MS);
    console.log('[ADRAY-REC] flush timer started, every', _ADRAY_FLUSH_MS, 'ms');
  }

  function _adrayStopRecording(reason) {
    if (_adrayStopFn) { try { _adrayStopFn(); } catch(_) {} _adrayStopFn = null; }
    if (_adrayFlushTimer) { clearInterval(_adrayFlushTimer); _adrayFlushTimer = null; }
    _adrayFlushChunk();
    if (!_adrayRecordingId) return;
    var body = JSON.stringify({
      account_id: getAccountId(),
      recording_id: _adrayRecordingId,
      session_id: getOrCreateSessionId(),
      reason: reason || 'session_end',
      final_chunk_index: _adrayChunkIndex,
      timestamp: new Date().toISOString()
    });
    var endpoint = _ADRAY_REC_BASE + '/collect/x/fin';
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
        return;
      }
    } catch(_) {}
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      keepalive: true,
      body: body
    }).catch(function(){});
  }

  // Flush remaining events on page unload
  window.addEventListener('pagehide', function() { _adrayFlushChunk(); });
  window.addEventListener('beforeunload', function() { _adrayFlushChunk(); });

  // Hook into sendEvent: trigger recording on add_to_cart, stop on purchase
  console.log('[ADRAY-REC] BRI recording module initialized. Hooking sendEvent...');
  var _adrayOrigSendEvent = sendEvent;
  sendEvent = function(eventName, eventData) {
    var result = _adrayOrigSendEvent.apply(this, arguments);
    console.log('[ADRAY-REC] sendEvent intercepted:', eventName);
    try {
      if (eventName === 'add_to_cart') {
        console.log('[ADRAY-REC] add_to_cart detected → loading rrweb');
        _adrayLoadRrweb(function() { _adrayStartRecording(eventData || {}); });
      }
      if (eventName === 'purchase') {
        console.log('[ADRAY-REC] purchase detected → stopping recording');
        _adrayStopRecording('purchase');
      }
    } catch(e) {
      console.error('[ADRAY-REC] sendEvent hook error:', e);
    }
    return result;
  };

  // =========================================================================
  // END ADRAY BRI Recording Module
  // =========================================================================

})();

