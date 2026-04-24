// AdRay Tracking Pixel - v2.0 (Universal)
// Usage: <script src="https://cdn.adray.io/pixel.js" data-account-id="acct_YOUR_ID"></script>
(function() {
  // Endpoint path: /m/s (non-obvious) bypasses most ad-blocker /collect rules.
  // Legacy /collect still served by backend for backward compat.
  var ADRAY_ENDPOINT_PATH = '/m/s';
  const ADRAY_ENDPOINT = (function () {
    try {
      var s = document.currentScript;
      if (s) {
        var ep = s.getAttribute('data-endpoint');
        if (ep) return ep.replace(/\/+$/, '');
        if (s.src) return new URL(s.src).origin + ADRAY_ENDPOINT_PATH;
      }
      var tags = document.querySelectorAll('script[src*="adray-pixel"], script[src*="site-analytics"], script[src*="pixel.js"]');
      for (var i = 0; i < tags.length; i++) {
        ep = tags[i].getAttribute('data-endpoint');
        if (ep) return ep.replace(/\/+$/, '');
        if (tags[i].src) return new URL(tags[i].src).origin + ADRAY_ENDPOINT_PATH;
      }
    } catch (_) {}
    return 'https://adray.ai' + ADRAY_ENDPOINT_PATH;
  }());
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

    // If fbclid present but _fbc cookie not set, synthesize it so Meta CAPI works
    // Format per Meta spec: fb.<subdomain_index>.<timestamp>.<fbclid>
    var fbclid = getQueryParam('fbclid');
    if (fbclid && !getCookie('_fbc')) {
      var fbc = 'fb.1.' + Date.now() + '.' + fbclid;
      setCookie('_fbc', fbc, 7776000); // 90 days
      safeStorageSet(window.localStorage, '__adray_attr_fbc', fbc);
    }

    if (changed) {
      safeStorageSet(window.localStorage, '__adray_attr_updated_at', String(Date.now()));
    }

    persistTrackedUtmHistory();
  }

  // Ensure fbclid/gclid from entry URL are captured even if current page lost them
  function captureClickIdFromEntryUrl() {
    var captured = {};
    try {
      // Source 1: landing page URL (saved on first load)
      var entryUrl = getLandingPageUrl();
      if (entryUrl) {
        var parsed = parseTrackedUrl(entryUrl);
        if (parsed) {
          var clicks = ['fbclid', 'gclid', 'ttclid', 'wbraid', 'gbraid', 'msclkid'];
          clicks.forEach(function(key) {
            if (safeStorageGet(window.localStorage, '__adray_attr_' + key)) return;
            var val = parsed.searchParams.get(key);
            if (val) {
              safeStorageSet(window.localStorage, '__adray_attr_' + key, val);
              captured[key] = val;
            }
          });
        }
      }

      // Source 2: document.referrer (when redirect stripped the param)
      // Facebook: https://l.facebook.com/l.php?u=<target>&h=<hash>&fbclid=...
      // The fbclid is in the referrer URL when coming from Facebook redirect
      var referrer = document.referrer || '';
      if (referrer) {
        try {
          var refUrl = new URL(referrer);
          // Direct fbclid in referrer
          var refFbclid = refUrl.searchParams.get('fbclid');
          if (refFbclid && !safeStorageGet(window.localStorage, '__adray_attr_fbclid')) {
            safeStorageSet(window.localStorage, '__adray_attr_fbclid', refFbclid);
            captured.fbclid = refFbclid;
          }
          // Referrer from facebook.com without fbclid → we know it's FB traffic
          if (/facebook\.com|fb\.com|instagram\.com/i.test(refUrl.hostname) &&
              !safeStorageGet(window.localStorage, '__adray_attr_utm_source')) {
            safeStorageSet(window.localStorage, '__adray_attr_utm_source', 'facebook');
            safeStorageSet(window.localStorage, '__adray_attr_utm_medium', 'social');
            captured.utm_source = 'facebook';
          }
          // Google referrer
          if (/google\.com|googleadservices\.com/i.test(refUrl.hostname) &&
              !safeStorageGet(window.localStorage, '__adray_attr_utm_source')) {
            safeStorageSet(window.localStorage, '__adray_attr_utm_source', 'google');
            captured.utm_source = 'google';
          }
        } catch (_) {}
      }
    } catch (_) {}
    adrayLog('captureClickIdFromEntryUrl:', captured, 'referrer:', document.referrer);
    return captured;
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

  // Debug mode: enable with ?adray_debug=1 or localStorage['__adray_debug']='1'
  var ADRAY_DEBUG = false;
  try {
    ADRAY_DEBUG = new URLSearchParams(window.location.search).get('adray_debug') === '1'
      || window.localStorage.getItem('__adray_debug') === '1';
    if (new URLSearchParams(window.location.search).get('adray_debug') === '1') {
      window.localStorage.setItem('__adray_debug', '1');
    }
  } catch (_) {}

  function adrayLog() {
    if (!ADRAY_DEBUG) return;
    try { console.log.apply(console, ['[AdRay Pixel]'].concat([].slice.call(arguments))); } catch (_) {}
  }

  /**
   * Detects page type based on URL and DOM (flexible for different locales and setups)
   */
  function detectPageType() {
    const path = window.location.pathname.toLowerCase();

    // Shopify patterns (most specific first)
    if (path.includes('/products/')) return 'product';
    if (path.includes('/collections/')) return 'collection';
    if (path.includes('/cart')) return 'cart';
    if (isOrderReceivedUrl(path)) return 'confirmation';
    if (path.includes('/checkout')) return 'checkout';

    // WooCommerce patterns (by URL, multiple locales) — priority over class/home
    if (/\/(order-received|pedido-recibido|gracias|thank-you)(\?|$|\/)/i.test(path)) return 'confirmation';
    if (/\/(checkout|finalizar-compra|finalizar|pedir|pagar|pago|compra|comprar)(\?|$|\/)/i.test(path)) return 'checkout';
    if (/\/(cart|carrito|carro|mi-carrito|my-cart|bag|basket|canasta|cesta)(\?|$|\/)/i.test(path)) return 'cart';
    if (/\/(product|producto|productos|shop|tienda)\/[^\/]+/i.test(path)) return 'product';

    // WooCommerce patterns (by body class — requires document.body)
    var body = document && document.body;
    if (body && body.classList) {
      if (body.classList.contains('woocommerce-order-received')) return 'confirmation';
      if (body.classList.contains('woocommerce-checkout')) return 'checkout';
      if (body.classList.contains('woocommerce-cart')) return 'cart';
      if (body.classList.contains('single-product')) return 'product';
      if (body.classList.contains('woocommerce-shop') ||
          body.classList.contains('archive')) return 'collection';
      if (body.classList.contains('home')) return 'home';
    }

    // DOM content detection fallback — detect by presence of key elements
    if (body) {
      // Checkout detection: has checkout form, billing fields, payment methods
      var hasCheckoutForm =
        document.querySelector('form.checkout, form.woocommerce-checkout, form[name="checkout"], #order_review, .wc-block-checkout, [data-block-name="woocommerce/checkout"]') ||
        document.querySelector('input[name="billing_email"], input[name="billing_first_name"], input[name="payment_method"]') ||
        document.querySelector('.payment_methods, .wc_payment_methods');
      if (hasCheckoutForm) return 'checkout';

      // Cart detection: has cart items table, update cart button, quantity inputs for cart
      var hasCartForm =
        document.querySelector('form.woocommerce-cart-form, .cart_totals, .wc-block-cart, [data-block-name="woocommerce/cart"]') ||
        document.querySelector('.shop_table.cart, .cart-collaterals, .cart-empty') ||
        document.querySelector('button[name="update_cart"]');
      if (hasCartForm) return 'cart';

      // Product detection: single product page structure
      var hasProduct =
        document.querySelector('.single-product, .product-single, form.cart[data-product_id], [itemtype*="schema.org/Product"]');
      if (hasProduct) return 'product';
    }

    // Root path is home as last resort
    if (path === '/' || path === '') return 'home';

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

  // Monotonic sequence per sessionStorage + post-purchase state persisted there.
  function _adrayNextSeq() {
    try {
      const raw = sessionStorage.getItem('_adray_event_seq');
      const next = (parseInt(raw, 10) || 0) + 1;
      sessionStorage.setItem('_adray_event_seq', String(next));
      return next;
    } catch (_) { return 0; }
  }

  function _adrayIsPostPurchase() {
    try { return sessionStorage.getItem('_adray_post_purchase') === '1'; }
    catch (_) { return false; }
  }

  function _adrayMarkPostPurchase() {
    try { sessionStorage.setItem('_adray_post_purchase', '1'); } catch (_) {}
  }

  function sendEvent(eventName, eventData = {}) {
    const now = Date.now();
    const dedupKey = `${eventName}:${eventData.page_url || window.location.href}`;
    const last = sentEventMap.get(dedupKey) || 0;
    if (now - last < EVENT_TTL_MS) {
      adrayLog('sendEvent: skipped', eventName, '(dedup, last fired', now - last, 'ms ago)');
      return;
    }
    sentEventMap.set(dedupKey, now);

    var fbclid = getAttributionParam('fbclid');
    var gclid = getAttributionParam('gclid');
    var ttclid = getAttributionParam('ttclid');
    var wbraid = getAttributionParam('wbraid');
    var gbraid = getAttributionParam('gbraid');
    var msclkid = getAttributionParam('msclkid');
    var fbp = getCookie('_fbp');
    var fbc = getAttributionParam('fbc') || getCookie('_fbc');

    // Fallback: extract fbclid from _fbc cookie (format: fb.1.<ts>.<fbclid>)
    if (!fbclid && fbc) {
      var fbcParts = String(fbc).split('.');
      if (fbcParts.length >= 4) fbclid = fbcParts.slice(3).join('.');
    }

    const capturedAt = new Date(now).toISOString();
    const seq = _adrayNextSeq();
    const postPurchase = _adrayIsPostPurchase();

    const payload = {
      timestamp: capturedAt,          // when the event actually happened (client clock)
      captured_at: capturedAt,        // explicit alias for ordering
      seq,                            // monotonic per-session sequence for tie-breaking
      post_purchase: postPurchase,    // true if purchase already fired in this session
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
    adrayLog('sending', eventName, 'to', ADRAY_ENDPOINT, 'fbclid:', fbclid, 'seq:', seq, 'page_type:', payload.page_type);

    _adrayDispatch(eventName, body);

    // After purchase ships, flip session flag so subsequent events are marked.
    if (eventName === 'purchase') {
      _adrayMarkPostPurchase();
    }
  }

  // Transport chain: sendBeacon → fetch(keepalive) + retry → Image pixel (GIF) → offline queue.
  // sendBeacon is preferred first because ad-blockers often hook fetch/XHR but leave beacon alone,
  // and it survives page unload. Image pixel is last-resort; ad-blockers rarely filter GIFs.
  function _adrayDispatch(eventName, body) {
    if (_adrayTrySendBeacon(body, eventName)) return;
    _adrayFetchWithRetry(body, eventName, 0);
  }

  function _adrayTrySendBeacon(body, eventName) {
    if (!navigator.sendBeacon) return false;
    try {
      var ok = navigator.sendBeacon(
        ADRAY_ENDPOINT,
        new Blob([body], { type: 'application/json' })
      );
      adrayLog('sendBeacon:', eventName, '→', ok ? 'OK' : 'FAILED');
      return ok === true;
    } catch (e) {
      adrayLog('sendBeacon error:', e);
      return false;
    }
  }

  var _ADRAY_MAX_RETRIES = 3;

  function _adrayFetchWithRetry(body, eventName, attempt) {
    adrayLog('fetch attempt', attempt + 1, 'for', eventName);
    fetch(ADRAY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body,
      mode: "cors",
      credentials: "include",
      keepalive: true,
    }).then(function (r) {
      adrayLog('fetch', eventName, '→', r.status);
      // Retry on 5xx; 4xx is client error, don't retry.
      if (r.status >= 500 && attempt + 1 < _ADRAY_MAX_RETRIES) {
        _adrayBackoff(attempt, function () { _adrayFetchWithRetry(body, eventName, attempt + 1); });
      }
    }).catch(function (err) {
      adrayLog('fetch error:', err && err.message);
      if (attempt + 1 < _ADRAY_MAX_RETRIES) {
        _adrayBackoff(attempt, function () { _adrayFetchWithRetry(body, eventName, attempt + 1); });
      } else {
        // Final fallback: GET GIF pixel with base64-encoded payload.
        if (!_adrayTryImagePixel(body, eventName)) {
          console.error("AdRay Pixel Error:", err);
          _adrayEnqueueOffline(body);
        }
      }
    });
  }

  function _adrayBackoff(attempt, fn) {
    // Exponential with jitter: 200ms, 400ms, 800ms ± 100ms.
    var base = 200 * Math.pow(2, attempt);
    var jitter = Math.floor(Math.random() * 100);
    setTimeout(fn, base + jitter);
  }

  function _adrayTryImagePixel(body, eventName) {
    try {
      // Compact fields for URL size limits (~2KB safe).
      var p = JSON.parse(body);
      var compact = {
        a: p.account_id, s: p.session_id, b: p.browser_id,
        e: p.event_name, t: p.captured_at || p.timestamp, q: p.seq,
        u: p.page_url, pt: p.page_type,
        fb: p.fbclid, gc: p.gclid, tc: p.ttclid,
        us: p.utm_source, um: p.utm_medium, uc: p.utm_campaign,
        ut: p.utm_term, uo: p.utm_content,
        cv: p.cart_value, oi: p.order_id, ck: p.checkout_token,
        rv: p.revenue, cu: p.currency,
        r: p.referrer, pl: p.platform
      };
      // base64url-encode (URL-safe, no padding) for query-string safety.
      var json = JSON.stringify(compact);
      var b64 = (typeof btoa === 'function') ? btoa(unescape(encodeURIComponent(json))) : null;
      if (!b64) return false;
      b64 = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      // Respect 2KB URL budget.
      if (ADRAY_ENDPOINT.length + b64.length + 8 > 2048) return false;
      var img = new Image(1, 1);
      img.referrerPolicy = 'no-referrer-when-downgrade';
      img.src = ADRAY_ENDPOINT + '?d=' + b64 + '&_=' + Date.now();
      adrayLog('image pixel fallback:', eventName);
      return true;
    } catch (e) {
      adrayLog('image pixel error:', e && e.message);
      return false;
    }
  }

  // Offline queue — if a send fails, persist to localStorage. Flushed on page
  // load and on the browser's `online` event. Bounded to ~50 entries to cap size.
  const _ADRAY_OFFLINE_KEY = '_adray_offline_queue_v1';
  const _ADRAY_OFFLINE_MAX = 50;
  const _ADRAY_OFFLINE_TTL_MS = 24 * 60 * 60 * 1000;

  function _adrayReadOfflineQueue() {
    try {
      const raw = localStorage.getItem(_ADRAY_OFFLINE_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (_) { return []; }
  }

  function _adrayWriteOfflineQueue(arr) {
    try { localStorage.setItem(_ADRAY_OFFLINE_KEY, JSON.stringify(arr.slice(-_ADRAY_OFFLINE_MAX))); } catch (_) {}
  }

  function _adrayEnqueueOffline(body) {
    const arr = _adrayReadOfflineQueue();
    arr.push({ body, at: Date.now() });
    _adrayWriteOfflineQueue(arr);
  }

  function _adrayFlushOfflineQueue() {
    const arr = _adrayReadOfflineQueue();
    if (!arr.length) return;
    const now = Date.now();
    const kept = [];
    for (const entry of arr) {
      if (!entry || !entry.body) continue;
      if (now - (entry.at || 0) > _ADRAY_OFFLINE_TTL_MS) continue; // drop stale
      try {
        fetch(ADRAY_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: entry.body,
          mode: "cors",
          credentials: "include",
          keepalive: true,
        }).catch(() => { kept.push(entry); });
      } catch (_) { kept.push(entry); }
    }
    _adrayWriteOfflineQueue(kept);
  }

  try {
    _adrayFlushOfflineQueue();
    window.addEventListener('online', _adrayFlushOfflineQueue);
  } catch (_) {}

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
  captureClickIdFromEntryUrl();  // Ensure fbclid/gclid captured from entry URL
  sendEvent("page_view");

  // Helper: detect cart/checkout and fire appropriate events
  function detectAndFireFunnelEvents() {
    var pageType = detectPageType();
    adrayLog('detectAndFireFunnelEvents: pageType =', pageType, 'url =', window.location.href);

    // 1.1 Product page view for funnel completeness (view_item)
    if (pageType === 'product') {
      const ctx = getProductContext();
      adrayLog('→ firing view_item', ctx);
      sendEvent('view_item', {
        product_id: ctx.product_id || null,
        variant_id: ctx.variant_id || null
      });
    }

    // 1.2 Cart page → fire add_to_cart if not recent (simple page-based detection)
    if (pageType === 'cart' && !isOrderReceivedUrl(window.location.pathname)) {
      var lastCartFire = safeStorageGet(window.sessionStorage, '__adray_cart_page_fired');
      var now = Date.now();
      if (!lastCartFire || (now - Number(lastCartFire) > 10000)) { // once per 10s
        safeStorageSet(window.sessionStorage, '__adray_cart_page_fired', String(now));
        var cartValue = detectCartValue(null, 1);
        adrayLog('→ firing add_to_cart, cart_value =', cartValue);
        sendEvent('add_to_cart', { cart_value: cartValue });
      } else {
        adrayLog('→ skipping add_to_cart (recent fire)');
      }
    }

    // 1.3 Checkout page → fire begin_checkout immediately (platform-agnostic)
    if (pageType === 'checkout' && !isOrderReceivedUrl(window.location.pathname)) {
      var token = getCookie('woocommerce_cart_hash') || getCookie('cart') || getCookie('cart_sig') || null;
      adrayLog('→ firing begin_checkout, token =', token);
      trackBeginCheckout({ checkout_token: token }, window.location.href);
    }
  }

  // Fire funnel events on initial page load
  detectAndFireFunnelEvents();

  // Re-detect on DOM ready (in case classes/content loaded after script)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', detectAndFireFunnelEvents);
  } else {
    setTimeout(detectAndFireFunnelEvents, 100);
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

  // 5b. Shopify: Purchase event on thank-you / order-status page.
  // Shopify checkout URLs follow these patterns:
  //   /checkouts/:token/thank_you            (standard)
  //   /checkouts/c/:token/thank_you          (checkout extensibility)
  //   /:shop/orders/:order_id                (order status page, logged-in customer)
  // Shopify also exposes `Shopify.checkout` on the thank-you page with
  //   { order_id, subtotal_price, total_price, currency, token, email, line_items }
  (function detectShopifyPurchase() {
    function looksLikeShopifyThankYou() {
      var path = window.location.pathname || '';
      if (/\/thank[-_]?you(\b|\/|$)/i.test(path)) return true;
      if (/\/checkouts\/(c\/)?[^\/]+\/thank[-_]?you/i.test(path)) return true;
      if (/\/orders\/\d+/i.test(path) && (window.Shopify || document.querySelector('meta[name="shopify-checkout-api-token"]'))) return true;
      return false;
    }

    function shopifyRevenue(co) {
      // Shopify price fields are strings or numbers — normalize.
      var candidates = [co.total_price, co.totalPrice, co.subtotal_price];
      for (var i = 0; i < candidates.length; i++) {
        var n = Number(candidates[i]);
        if (Number.isFinite(n) && n > 0) return n;
      }
      return null;
    }

    function shopifyLineItems(co) {
      var items = co.line_items || co.lineItems || [];
      if (!Array.isArray(items)) return null;
      return items.map(function(li) {
        return {
          id:       li.id || li.product_id || li.variant_id || null,
          sku:      li.sku || null,
          name:     li.title || li.name || li.product_title || null,
          quantity: Number(li.quantity || 1),
          price:    Number(li.price || li.final_price || 0),
        };
      });
    }

    if (!looksLikeShopifyThankYou()) return;

    // Primary: Shopify.checkout global on thank-you page.
    var co = (window.Shopify && window.Shopify.checkout) || window.__SHOPIFY_CHECKOUT__ || null;

    if (co) {
      var orderId = String(co.order_id || co.orderId || '') || null;
      var revenue = shopifyRevenue(co);
      var currency = String(co.currency || co.presentment_currency || 'USD').toUpperCase();

      sendEvent('purchase', {
        event_id: orderId ? 'brw_sh_' + orderId : undefined,
        order_id: orderId,
        revenue:  revenue,
        currency: currency,
        items:    shopifyLineItems(co),
        checkout_token: co.token || co.checkout_token || null,
        customer_email: co.email || null,
      });
      return;
    }

    // Fallback: scrape from URL + meta tags.
    var fromUrl = window.location.pathname.match(/\/orders\/(\d+)/) ||
                  window.location.pathname.match(/\/checkouts\/(?:c\/)?([^\/]+)\/thank/i);
    sendEvent('purchase', {
      event_id: fromUrl ? 'brw_sh_' + fromUrl[1] : undefined,
      order_id: fromUrl ? fromUrl[1] : null,
      currency: (document.querySelector('meta[property="og:price:currency"]')||{}).content || null,
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

      // (deprecated) We no longer emit a clarity_session_linked live event.
      // rrweb is the primary recording stack now, and the Clarity link was
      // causing noise in the live feed without adding signal value.
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
  var _ADRAY_REC_BASE = ADRAY_ENDPOINT.replace(/\/(m\/s|collect)$/, '');
  var _ADRAY_RRWEB_CDN = _ADRAY_REC_BASE + '/static/dom-observer.min.js';

  // ── Blocked pages: Shopify prohibits DOM recording on checkout/payment pages
  //    without the read_advanced_dom_pixel_events scope. We exclude them entirely.
  function _adrayIsBlockedPage() {
    try {
      var host = window.location.hostname;
      var path = window.location.pathname;

      // Shopify hosted checkout domain (separate origin from the storefront)
      if (/checkout\.shopify\.com$/i.test(host)) return true;
      if (/shop\.app$/i.test(host)) return true;

      // Shopify checkout paths on *.myshopify.com
      if (/^\/checkouts?\//i.test(path)) return true;
      if (/\/thank_you/i.test(path)) return true;
      if (/\/orders\//i.test(path)) return true;

      // WooCommerce checkout & order pages
      if (/^\/checkout(\/|$)/i.test(path)) return true;
      if (/\/order-received\//i.test(path)) return true;
      if (/\/order-pay\//i.test(path)) return true;

      // Generic payment/account sensitive pages
      if (/^\/account\/(login|register|password)/i.test(path)) return true;

      return false;
    } catch(_) { return false; }
  }

  // ── Session persistence: resume recording across SPA/checkout navigations ──
  var _SS_REC_KEY  = 'adray_rec_id';
  var _SS_CIDX_KEY = 'adray_rec_cidx';

  function _adraySaveRecState() {
    try {
      if (_adrayRecordingId) {
        sessionStorage.setItem(_SS_REC_KEY, _adrayRecordingId);
        sessionStorage.setItem(_SS_CIDX_KEY, String(_adrayChunkIndex));
      }
    } catch(_) {}
  }

  function _adrayRestoreRecState() {
    try {
      var id  = sessionStorage.getItem(_SS_REC_KEY);
      var idx = sessionStorage.getItem(_SS_CIDX_KEY);
      if (id) { _adrayRecordingId = id; _adrayChunkIndex = idx ? parseInt(idx, 10) : 0; }
    } catch(_) {}
  }

  function _adrayClearRecState() {
    try {
      sessionStorage.removeItem(_SS_REC_KEY);
      sessionStorage.removeItem(_SS_CIDX_KEY);
    } catch(_) {}
  }

  // ── Consent (Phase 0 — arch v2) ────────────────────────────────────────────
  // Cookie-backed opt-in / opt-out. Default behavior when no cookie exists is
  // to record (backward compatible); merchants wanting strict GDPR call
  //   window.adrayConsent('denied')
  // before the pixel runs. The merchant is responsible for the UI.
  var _ADRAY_CONSENT_COOKIE = 'adray_consent';

  function _adrayGetConsent() {
    try {
      var m = document.cookie.match(/(?:^|;\s*)adray_consent=([^;]+)/);
      return m ? decodeURIComponent(m[1]) : null;
    } catch(_) { return null; }
  }

  function _adraySetConsentCookie(state) {
    try {
      var d = new Date();
      d.setTime(d.getTime() + 13 * 30 * 24 * 60 * 60 * 1000); // 13 months
      document.cookie = _ADRAY_CONSENT_COOKIE + '=' + encodeURIComponent(state)
        + '; expires=' + d.toUTCString() + '; path=/; SameSite=Lax';
    } catch(_) {}
  }

  // Public API: adrayConsent('granted'|'denied'). Revokes or grants recording live.
  window.adrayConsent = function(state) {
    if (state !== 'granted' && state !== 'denied') return;
    _adraySetConsentCookie(state);
    if (state === 'denied') {
      try { _adrayStopRecording('consent_denied'); } catch(_) {}
    } else if (state === 'granted' && !_adrayStopFn) {
      _adrayLoadRrweb(function() { _adrayStartRecording({ trigger: 'consent_granted' }); });
    }
  };

  function _adrayDetectDevice() {
    var ua = (navigator.userAgent || '').toLowerCase();
    if (/ipad|tablet|playbook|silk/i.test(ua)) return 'tablet';
    if (/mobi|android|iphone|ipod|phone/i.test(ua)) return 'mobile';
    return 'desktop';
  }

  // ── Chunk retry: fetch with up to 5 retries, exponential backoff (handles server cold-start) ──
  // Delays: 2s, 4s, 8s, 16s, 32s — total ~62s max wait
  // keepalive has a 64 KB body limit — anything larger (e.g. chunk 0 with FullSnapshot) fails
  // silently. Only use keepalive for small bodies; mid-session large chunks are safe without it
  // because the page is still alive, and the unload path uses sendBeacon instead.
  var _ADRAY_MAX_RETRIES = 5;
  var _ADRAY_KEEPALIVE_MAX = 60000;
  function _adraySendChunkWithRetry(endpoint, body, attempt) {
    attempt = attempt || 0;
    var opts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body
    };
    if (body.length <= _ADRAY_KEEPALIVE_MAX) opts.keepalive = true;
    fetch(endpoint, opts).then(function(r) {
      if (!r.ok && attempt < _ADRAY_MAX_RETRIES) {
        setTimeout(function() { _adraySendChunkWithRetry(endpoint, body, attempt + 1); }, 2000 * Math.pow(2, attempt));
      } else {
        console.log('[ADRAY-REC] chunk sent →', r.status, attempt > 0 ? '(retry ' + attempt + ')' : '');
      }
    }).catch(function(e) {
      if (attempt < _ADRAY_MAX_RETRIES) {
        setTimeout(function() { _adraySendChunkWithRetry(endpoint, body, attempt + 1); }, 2000 * Math.pow(2, attempt));
      } else {
        console.error('[ADRAY-REC] chunk FAILED after retries:', e.message || e);
      }
    });
  }

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
    if (!_adrayChunkBuffer.length || !_adrayRecordingId) { return; }
    // Chunk 0 must contain a FullSnapshot (type 2) — defer until rrweb emits it.
    // Guards against premature flushes (stale timers, unload handler) before rrweb.record() fires.
    if (_adrayChunkIndex === 0 && !_adrayChunkBuffer.some(function(e) { return e.type === 2; })) { return; }
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
    _adraySaveRecState();
    // Always use fetch+retry for mid-session chunks so we can detect and retry 404/503.
    // sendBeacon is only used in _adrayHandleUnload (page-unload path).
    _adraySendChunkWithRetry(endpoint, body, 0);
  }

  function _adrayStartRecording(cartPayload) {
    console.log('[ADRAY-REC] _adrayStartRecording called. stopFn:', !!_adrayStopFn, 'rrweb:', !!window.rrweb);
    if (_adrayStopFn) { console.log('[ADRAY-REC] already recording, skip'); return; }
    if (!window.rrweb || !window.rrweb.record) { console.error('[ADRAY-REC] rrweb.record not available!'); return; }

    // Resume existing recording from sessionStorage if this is a mid-flow page navigation
    _adrayRestoreRecState();
    if (!_adrayRecordingId) {
      _adrayRecordingId = 'rec_' + generateId();
      _adrayChunkIndex = 0;
    }
    _adrayChunkBuffer = [];
    _adraySaveRecState();
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
        trigger_event: (cartPayload && cartPayload.trigger) || 'add_to_cart',
        cart_value: cartPayload && cartPayload.cart_value ? cartPayload.cart_value : null,
        checkout_token: cartPayload && cartPayload.checkout_token ? cartPayload.checkout_token : null,
        device_type: _adrayDetectDevice(),
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
          // Send FullSnapshot immediately so it's not lost if user navigates before timer fires
          if (event.type === 2) {
            _adrayFlushChunk();
          } else if (JSON.stringify(_adrayChunkBuffer).length >= _ADRAY_CHUNK_MAX_BYTES) {
            _adrayFlushChunk();
          }
        },
        maskAllInputs: true,
        maskInputOptions: { password: true, email: true, tel: true, text: false, number: false },
        inlineStylesheet: true,
        inlineImages: false,
        blockSelector: '[data-adray-block]',
        blockClass: 'adray-block',
        ignoreClass: 'adray-ignore',
        sampling: {
          mousemove: 50,          // arch v2
          mouseInteraction: true,
          scroll: 150,
          input: 'last',
          media: 800
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
    _adrayClearRecState();
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

  // Arch v2: on page unload we only flush the buffer. We DO NOT call /fin and
  // DO NOT clear sessionStorage — the same recordingId must survive same-origin
  // navigation so the session's keyframe stream is continuous. Server-side
  // sweep finalizes by inactivity timeout (5min per arch v2).
  function _adrayHandleUnload() {
    _adrayFlushChunk();
    // sessionStorage persists; /fin is NOT sent here anymore.
  }
  window.addEventListener('pagehide', _adrayHandleUnload);
  window.addEventListener('beforeunload', _adrayHandleUnload);

  // Helper: inject a tagged Custom event (rrweb type=5) into the active stream.
  // The keyframe extractor reads these tags: add_to_cart, begin_checkout,
  // purchase, remove_from_cart, visibility_change, product_view, page_view.
  function _adrayEmitCustom(tag, payload) {
    if (!_adrayStopFn) return false;
    try {
      if (window.rrweb && window.rrweb.record && typeof window.rrweb.record.addCustomEvent === 'function') {
        window.rrweb.record.addCustomEvent(tag, payload || {});
        return true;
      }
    } catch(_) {}
    return false;
  }

  // Hook into sendEvent: inject ecommerce events as Custom events in the rrweb
  // stream. Recording itself is started on page load (see _adrayBootRecording
  // below), not here.
  console.log('[ADRAY-REC] BRI recording module initialized. Hooking sendEvent...');
  var _adrayOrigSendEvent = sendEvent;
  sendEvent = function(eventName, eventData) {
    var result = _adrayOrigSendEvent.apply(this, arguments);
    console.log('[ADRAY-REC] sendEvent intercepted:', eventName);
    try {
      if (eventName === 'add_to_cart' || eventName === 'begin_checkout' || eventName === 'remove_from_cart') {
        // Inject into the active stream; fallback: start recording if not yet running.
        // Never start recording on blocked pages (checkout, payment, etc.).
        if (!_adrayEmitCustom(eventName, eventData || {})) {
          if (!_adrayIsBlockedPage()) {
            _adrayLoadRrweb(function() {
              _adrayStartRecording({ trigger: eventName });
              // rrweb takes a tick to expose addCustomEvent after record() — retry.
              setTimeout(function() { _adrayEmitCustom(eventName, eventData || {}); }, 100);
            });
          }
        }
      }
      if (eventName === 'purchase') {
        console.log('[ADRAY-REC] purchase → inject custom event + finalize');
        _adrayEmitCustom('purchase', eventData || {});
        // Flush one more time to ensure the purchase event reaches the server
        // before /fin races.
        _adrayFlushChunk();
        _adrayStopRecording('purchase');
      }
    } catch(e) {
      console.error('[ADRAY-REC] sendEvent hook error:', e);
    }
    return result;
  };

  // Visibility change: custom event for tab_switch keyframe extraction.
  document.addEventListener('visibilitychange', function() {
    _adrayEmitCustom('visibility_change', { hidden: document.hidden });
  });

  // Product view: IntersectionObserver emits a product_view Custom event the
  // first time a product card scrolls into view. Merchants tag elements with
  // [data-adray-product]. Extra attributes (data-adray-product-id, -name,
  // -price) enrich the payload for the keyframe extractor's hitTestProducts.
  (function _adrayProductObserver() {
    if (typeof IntersectionObserver === 'undefined') return;
    var seen = new WeakSet();
    var io = new IntersectionObserver(function(entries) {
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (!e.isIntersecting || seen.has(e.target)) continue;
        seen.add(e.target);
        var el = e.target;
        var bb = e.boundingClientRect;
        _adrayEmitCustom('product_view', {
          element_id: el.getAttribute('data-adray-product') || el.id || null,
          product_id: el.getAttribute('data-adray-product-id') || el.getAttribute('data-adray-product') || null,
          name:  el.getAttribute('data-adray-product-name') || null,
          price: parseFloat(el.getAttribute('data-adray-product-price') || '') || null,
          bbox: {
            x: Math.round(bb.left + (window.scrollX || 0)),
            y: Math.round(bb.top  + (window.scrollY || 0)),
            w: Math.round(bb.width),
            h: Math.round(bb.height)
          }
        });
      }
    }, { threshold: 0.5 });
    function observeAll() {
      var els = document.querySelectorAll('[data-adray-product]');
      for (var i = 0; i < els.length; i++) io.observe(els[i]);
    }
    if (document.body) observeAll();
    var mo = new MutationObserver(observeAll);
    var startMo = function() {
      try { mo.observe(document.body || document.documentElement, { childList: true, subtree: true }); } catch(_) {}
    };
    if (document.body) startMo(); else document.addEventListener('DOMContentLoaded', startMo);
  })();

  // Boot: start recording on page load (arch v2). Resume if sessionStorage has
  // a persisted recordingId; otherwise create a fresh one.
  // Skips recording on checkout/payment pages (Shopify blocks DOM recording there
  // without read_advanced_dom_pixel_events scope). Ecommerce events still fire.
  (function _adrayBootRecording() {
    try {
      if (_adrayGetConsent() === 'denied') {
        console.log('[ADRAY-REC] consent=denied → skipping rrweb');
        return;
      }
      if (_adrayIsBlockedPage()) {
        console.log('[ADRAY-REC] blocked page → skipping rrweb', window.location.pathname);
        return;
      }
      var persisted = sessionStorage.getItem(_SS_REC_KEY);
      var trigger = persisted ? 'resumed' : 'page_load';
      console.log('[ADRAY-REC] boot →', trigger, persisted ? '('+persisted+')' : '');
      _adrayLoadRrweb(function() { _adrayStartRecording({ trigger: trigger }); });
    } catch(e) {
      console.error('[ADRAY-REC] boot error:', e);
    }
  })();

  // =========================================================================
  // END ADRAY BRI Recording Module
  // =========================================================================

})();

