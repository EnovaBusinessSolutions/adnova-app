// AdRay Tracking Pixel - v2.0 (Universal)
// Usage: <script src="https://cdn.adray.io/pixel.js" data-account-id="acct_YOUR_ID"></script>
(function() {
  const ADRAY_ENDPOINT = "https://adray-app-staging-german.onrender.com/collect";
  const EVENT_TTL_MS = 2000;
  const sentEventMap = new Map();
  
  // Helpers
  function getCookie(name) {
    const value = "; " + document.cookie;
    const parts = value.split("; " + name + "=");
    if (parts.length === 2) return parts.pop().split(";").shift();
    return null;
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

  function generateId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
      }
    } catch (_) {}
    return 'adray_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
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

  function persistAttributionParams() {
    var keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'ttclid', 'ga4_session_source'];
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
    if (path.includes('/checkout')) return 'checkout';
    
    // WooCommerce patterns
    if (document.body.classList.contains('home')) return 'home';
    if (document.body.classList.contains('single-product')) return 'product';
    if (document.body.classList.contains('woocommerce-shop') || 
        document.body.classList.contains('archive')) return 'collection';
    if (document.body.classList.contains('woocommerce-cart')) return 'cart';
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

    const payload = {
      account_id: getAccountId(),
      session_id: getOrCreateSessionId(),
      platform: detectPlatform(),
      event_name: eventName,
      page_url: window.location.href,
      landing_page_url: getLandingPageUrl(),
      page_type: detectPageType(),
      user_agent: navigator.userAgent,
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      fbclid: getAttributionParam('fbclid'),
      gclid: getAttributionParam('gclid'),
      ttclid: getAttributionParam('ttclid'),
      utm_source: getAttributionParam('utm_source'),
      utm_medium: getAttributionParam('utm_medium'),
      utm_campaign: getAttributionParam('utm_campaign'),
      utm_content: getAttributionParam('utm_content'),
      utm_term: getAttributionParam('utm_term'),
      ga4_session_source: getAttributionParam('ga4_session_source'),
      referrer: document.referrer,
      fbp: getCookie('_fbp'),
      fbc: getCookie('_fbc'),
      ...getUserIdentityContext(),
      ...eventData
    };

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
    return typeof url === 'string' && /\/checkout(\?|$|\/)/i.test(url);
  }

  function getProductContext() {
    let productId = null;
    let variantId = null;

    try {
      const shopifyMeta = window.ShopifyAnalytics?.meta?.product;
      if (shopifyMeta) {
        productId = shopifyMeta.id ? String(shopifyMeta.id) : productId;
        variantId = shopifyMeta.selectedVariantId ? String(shopifyMeta.selectedVariantId) : variantId;
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
      }
    } catch (_) {}

    return { product_id: productId, variant_id: variantId };
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
             cart_value: data.price ? data.price / 100 : null
         });
       } catch (e) {}
    }

    // Shopify begin checkout (AJAX/cart endpoints)
    if (isCheckoutUrl(url)) {
      sendEvent("begin_checkout", {
        checkout_token: getCookie('cart') || getCookie('cart_sig') || null
      });
    }
    
    // WooCommerce: REST + wc-ajax + add-to-cart endpoints
    if (isWooCartAddUrl(url)) {
       try {
         const clonedRes = response.clone();
         const data = await clonedRes.json();
         sendEvent("add_to_cart", {
             product_id: data.items?.[0]?.id ? String(data.items[0].id) : null,
             variant_id: data.items?.[0]?.variation_id ? String(data.items[0].variation_id) : null,
             cart_value: data.totals?.total_price ? parseFloat(data.totals.total_price) / 100 : null
         });
       } catch (e) {
         sendEvent('add_to_cart', getProductContext());
       }
    }
    
    return response;
  };

  // 3. WooCommerce: AJAX add to cart (fallback for classic themes)
  if (typeof jQuery !== 'undefined') {
    jQuery(document.body).on('added_to_cart', function(event, fragments, cart_hash, $button) {
      const productId = $button ? $button.data('product_id') : null;
      const quantity = $button ? $button.data('quantity') : 1;
      sendEvent("add_to_cart", {
        product_id: productId ? String(productId) : null,
        quantity: quantity
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
            cart_value: null
          });
        }
        if (isWooCartAddUrl(xhrUrl)) {
          sendEvent('add_to_cart', getProductContext());
        }
        if (isCheckoutUrl(xhrUrl)) {
          sendEvent("begin_checkout", {
            checkout_token: getCookie('cart') || getCookie('cart_sig') || null
          });
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
          quantity: Number.isFinite(qty) ? qty : 1
        });
      }

      if (isWooCartAddUrl(action) || form.querySelector('[name="add-to-cart"]')) {
        const wcProductId = form.querySelector('[name="add-to-cart"]')?.value || form.querySelector('[name="product_id"]')?.value || null;
        const wcQty = Number(form.querySelector('[name="quantity"]')?.value || 1);
        sendEvent('add_to_cart', {
          product_id: wcProductId ? String(wcProductId) : (getProductContext().product_id || null),
          quantity: Number.isFinite(wcQty) ? wcQty : 1
        });
      }

      if (isCheckoutUrl(action)) {
        sendEvent('begin_checkout', {
          checkout_token: getCookie('cart') || getCookie('cart_sig') || null
        });
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
        sendEvent('add_to_cart', getProductContext());
      }

      if (likelyCheckout) {
        sendEvent('begin_checkout', {
          checkout_token: getCookie('cart') || getCookie('cart_sig') || null
        });
      }
    } catch (_) {}
  }, true);

  // 4. WooCommerce: Checkout begin detection
  if (detectPlatform() === 'woocommerce' && detectPageType() === 'checkout') {
    sendEvent("begin_checkout", {
      checkout_token: getCookie('woocommerce_cart_hash') || null
    });
  }

  setupCheckoutIdentityBlurTracking();

  // 4.1 Shopify: checkout page hit detection (if script is present there)
  if (detectPlatform() === 'shopify' && isCheckoutUrl(window.location.pathname)) {
    sendEvent("begin_checkout", {
      checkout_token: getCookie('cart') || getCookie('cart_sig') || null
    });
  }

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
        checkout_token: o.checkout_token || null
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

})();

