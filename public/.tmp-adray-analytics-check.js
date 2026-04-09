
        let currentShopId = null;
        let currentAttributionModel = 'last_touch';
        let attributionChartInstance = null;
        let attributionPieChartInstance = null;
        let recentPurchasesState = [];
        let metricCarouselIndex = 0;
        let metricCarouselVisible = 4;
        let wpUsersPollTimer = null;
        let wpUsersFetchInFlight = false;
        let wpUsersLastFetchAt = 0;
        const WP_USERS_FETCH_MIN_INTERVAL_MS = 15000;
        const WP_USERS_POLL_INTERVAL_MS = 3000;
        let analyticsFetchInFlight = false;
        let overviewFetchInFlight = false;
        let sessionOverviewLastLoadedAt = 0;
        const SESSION_OVERVIEW_CACHE_TTL_MS = 120000;
        let wpUsersOnlineState = {
            users: [],
            updatedAt: null,
            hasError: false,
        };
        let currentStoreTypeLabel = 'Store';
        let storeTypeSignals = {
            sawWordPressEndpoint: false,
            sawWordPressUsers: false,
        };
        let attributionJourneyState = {
            channel: 'all',
            profileKey: 'all',
            profileSearch: '',
            profileSort: 'orders',
            selectedJourneyKey: '',
        };
        let selectedJourneyTimelineMode = 'condensed';
        let sessionExplorerState = {
            mode: 'overview',
            overview: null,
            currentSessionId: null,
            currentSessionStartedAt: null,
            peers: [],
            timeline: [],
            currentData: null,
            compareData: null,
        };
        let wooProfilesState = {
            profiles: [],
            loadedAt: 0,
            loading: false,
        };
        let journeyProfileLookupState = {
            byCustomerId: new Map(),
            byUserKey: new Map(),
            byName: [],
        };
        let liveFeedIdentityState = {
            bySessionId: new Map(),
            byUserKey: new Map(),
            byCustomerId: new Map(),
        };
        let journeyProfileSearchDebounceTimer = null;
        const SHOP_STORAGE_KEY = 'adray_analytics_shop';
        const KNOWN_SHOPS_STORAGE_KEY = 'adray_analytics_known_shops';
        const MAX_KNOWN_SHOPS = 12;
        let authorizedShopOptions = [];
        let hasRenderedInitialAnalytics = false;

        function logAnalyticsDebug(message, payload = {}) {
            try {
                console.log(`[AdRay Analytics] ${message}`, payload);
            } catch (error) {
                // noop
            }
        }

        function setAnalyticsLoadingState(active, {
            mode = hasRenderedInitialAnalytics ? 'refresh' : 'boot',
            title = '',
            copy = '',
        } = {}) {
            const body = document.body;
            const overlay = document.getElementById('analytics-loader');
            const overlayTitle = document.getElementById('analytics-loader-title');
            const overlayCopy = document.getElementById('analytics-loader-copy');
            const indicator = document.getElementById('analytics-refresh-indicator');
            const indicatorTitle = document.getElementById('analytics-refresh-title');
            const indicatorCopy = document.getElementById('analytics-refresh-copy');

            if (overlayTitle && title) overlayTitle.textContent = title;
            if (overlayCopy && copy) overlayCopy.textContent = copy;
            if (indicatorTitle && title) indicatorTitle.textContent = title;
            if (indicatorCopy && copy) indicatorCopy.textContent = copy;

            if (!body) return;

            if (!active) {
                body.dataset.analyticsLoading = 'idle';
                if (overlay) overlay.classList.add('is-hidden');
                if (indicator) indicator.classList.remove('is-visible');
                return;
            }

            body.dataset.analyticsLoading = mode;

            if (mode === 'boot' && !hasRenderedInitialAnalytics) {
                if (overlay) overlay.classList.remove('is-hidden');
                if (indicator) indicator.classList.remove('is-visible');
                return;
            }

            if (overlay) overlay.classList.add('is-hidden');
            if (indicator) indicator.classList.add('is-visible');
        }

        function markAnalyticsReady() {
            hasRenderedInitialAnalytics = true;
            setAnalyticsLoadingState(false);
        }

        function formatDateInputValue(date) {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        }

        function initializeDateControls() {
            const end = new Date();
            const start = new Date();
            start.setDate(start.getDate() - 30);
            const startInput = document.getElementById('start-date');
            const endInput = document.getElementById('end-date');
            if (startInput) startInput.value = formatDateInputValue(start);
            if (endInput) endInput.value = formatDateInputValue(end);
            onDatePresetChange();
        }

        function onDatePresetChange() {
            const preset = document.getElementById('date-preset')?.value || '30d';
            const startInput = document.getElementById('start-date');
            const endInput = document.getElementById('end-date');
            const isCustom = preset === 'custom';

            if (startInput) startInput.disabled = preset === 'all';
            if (endInput) endInput.disabled = preset === 'all';

            if (!isCustom && preset !== 'all') {
                const end = new Date();
                const start = new Date();
                const days = Number.parseInt(preset.replace('d', ''), 10) || 30;
                start.setDate(start.getDate() - days);
                if (startInput) startInput.value = formatDateInputValue(start);
                if (endInput) endInput.value = formatDateInputValue(end);
            }

            updateDateRangeLabel();
        }

        function updateDateRangeLabel(summary) {
            const label = document.getElementById('date-range-label');
            if (!label) return;

            if (summary?.allTime) {
                label.textContent = 'Toda la historia';
                return;
            }

            const preset = document.getElementById('date-preset')?.value || '30d';
            if (preset === '7d') label.textContent = 'Last 7 days';
            else if (preset === '30d') label.textContent = 'Last 30 days';
            else if (preset === '90d') label.textContent = 'Last 90 days';
            else if (preset === '365d') label.textContent = 'Last 12 months';
            else if (preset === 'custom') {
                const startValue = document.getElementById('start-date')?.value || '';
                const endValue = document.getElementById('end-date')?.value || '';
                label.textContent = startValue && endValue ? `${startValue} to ${endValue}` : 'Custom range';
            } else {
                label.textContent = 'Current range';
            }
        }

        function getShopIdFromUrl() {
            const urlParams = new URLSearchParams(window.location.search);
            return (
                urlParams.get('shop') ||
                urlParams.get('shopId') ||
                urlParams.get('store') ||
                ''
            ).trim();
        }

        function normalizeShopId(value) {
            return String(value || '').trim();
        }

        function readLocalStorageValue(key) {
            try {
                return localStorage.getItem(key) || '';
            } catch (error) {
                return '';
            }
        }

        function writeLocalStorageValue(key, value) {
            try {
                localStorage.setItem(key, value);
            } catch (error) {
                // noop
            }
        }

        function readStoredShopId() {
            return normalizeShopId(readLocalStorageValue(SHOP_STORAGE_KEY));
        }

        function persistCurrentShopId(shopName) {
            const normalized = normalizeShopId(shopName);
            if (!normalized) return;
            writeLocalStorageValue(SHOP_STORAGE_KEY, normalized);
        }

        function readKnownShops() {
            try {
                const raw = readLocalStorageValue(KNOWN_SHOPS_STORAGE_KEY);
                const parsed = raw ? JSON.parse(raw) : [];
                if (!Array.isArray(parsed)) return [];

                return parsed
                    .map((item) => ({
                        shop: normalizeShopId(item?.shop),
                        type: mapStoreTypeLabel(item?.type),
                        lastSeenAt: String(item?.lastSeenAt || ''),
                    }))
                    .filter((item) => item.shop);
            } catch (error) {
                return [];
            }
        }

        function writeKnownShops(items) {
            try {
                localStorage.setItem(KNOWN_SHOPS_STORAGE_KEY, JSON.stringify(items.slice(0, MAX_KNOWN_SHOPS)));
            } catch (error) {
                // noop
            }
        }

        function registerKnownShop(shopName, rawType) {
            const normalized = normalizeShopId(shopName);
            if (!normalized) return;

            const nextEntry = {
                shop: normalized,
                type: mapStoreTypeLabel(rawType || inferStoreTypeFromShopId(normalized)),
                lastSeenAt: new Date().toISOString(),
            };

            const deduped = readKnownShops().filter((item) => item.shop !== normalized);
            writeKnownShops([nextEntry, ...deduped]);
        }

        function getKnownShopOptions(extraItems = []) {
            const merged = [...extraItems, ...authorizedShopOptions, ...readKnownShops()];
            const byShop = new Map();
            const allowedShops = authorizedShopOptions.length
                ? new Set(authorizedShopOptions.map((item) => normalizeShopId(item?.shop)).filter(Boolean))
                : null;

            merged.forEach((item) => {
                const shop = normalizeShopId(item?.shop);
                if (!shop || byShop.has(shop)) return;
                if (allowedShops && !allowedShops.has(shop)) return;

                byShop.set(shop, {
                    shop,
                    type: mapStoreTypeLabel(item?.type || inferStoreTypeFromShopId(shop)),
                    lastSeenAt: String(item?.lastSeenAt || ''),
                });
            });

            return Array.from(byShop.values());
        }

        async function fetchAuthorizedShopOptions() {
            try {
                const res = await fetch('/api/analytics/shops');
                const body = await res.json().catch(() => ({}));

                if (!res.ok || body?.ok === false) {
                    logAnalyticsDebug('authorized shops response not ok', {
                        ok: res.ok,
                        status: res.status,
                        body,
                    });
                    authorizedShopOptions = [];
                    return { shops: [], defaultShop: '' };
                }

                const shops = Array.isArray(body?.shops)
                    ? body.shops
                        .map((item) => ({
                            shop: normalizeShopId(item?.shop),
                            type: mapStoreTypeLabel(item?.type || inferStoreTypeFromShopId(item?.shop)),
                            isDefault: !!item?.isDefault,
                            lastSeenAt: String(item?.updatedAt || ''),
                        }))
                        .filter((item) => item.shop)
                    : [];

                authorizedShopOptions = shops;
                shops.forEach((item) => registerKnownShop(item.shop, item.type));

                logAnalyticsDebug('authorized shops response', {
                    ok: res.ok,
                    defaultShop: body?.defaultShop || null,
                    shops: shops.map((item) => ({
                        shop: item.shop,
                        type: item.type,
                        isDefault: item.isDefault,
                    })),
                });

                const defaultShop = normalizeShopId(
                    body?.defaultShop ||
                    shops.find((item) => item.isDefault)?.shop ||
                    shops[0]?.shop ||
                    ''
                );

                return { shops, defaultShop };
            } catch (error) {
                console.warn('Authorized shops API failed:', error);
                logAnalyticsDebug('authorized shops request failed', {
                    message: error?.message || String(error || ''),
                });
                authorizedShopOptions = [];
                return { shops: [], defaultShop: '' };
            }
        }

        function buildAnalyticsUrlForShop(shopName) {
            const url = new URL(window.location.href);
            const normalized = normalizeShopId(shopName);
            if (normalized) url.searchParams.set('shop', normalized);
            else url.searchParams.delete('shop');
            url.searchParams.delete('shopId');
            url.searchParams.delete('store');
            return url.toString();
        }

        function replaceCurrentShopInUrl(shopName) {
            const nextUrl = buildAnalyticsUrlForShop(shopName);
            window.history.replaceState({}, '', nextUrl);
        }

        function closeShopSwitcher() {
            const menu = document.getElementById('shop-switcher-menu');
            const button = document.getElementById('shop-switcher-button');
            if (menu) menu.classList.add('hidden');
            if (button) button.setAttribute('aria-expanded', 'false');
        }

        function toggleShopSwitcher(forceOpen) {
            const menu = document.getElementById('shop-switcher-menu');
            const button = document.getElementById('shop-switcher-button');
            if (!menu || !button) return;

            const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : menu.classList.contains('hidden');
            menu.classList.toggle('hidden', !shouldOpen);
            button.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
        }

        function notifyParentShopChanged(shopName, rawType) {
            try {
                if (window.parent && window.parent !== window) {
                    window.parent.postMessage(
                        {
                            type: 'adray:analytics:shop-changed',
                            shop: normalizeShopId(shopName),
                            storeType: mapStoreTypeLabel(rawType || inferStoreTypeFromShopId(shopName)),
                        },
                        window.location.origin
                    );
                }
            } catch (error) {
                console.warn('Unable to notify parent about shop change:', error);
            }
        }

        function navigateToSelectedShop(shopName, rawType) {
            const normalized = normalizeShopId(shopName);
            if (!normalized || normalized === currentShopId) {
                closeShopSwitcher();
                return;
            }

            registerKnownShop(normalized, rawType);
            persistCurrentShopId(normalized);
            notifyParentShopChanged(normalized, rawType);
            closeShopSwitcher();
            window.location.assign(buildAnalyticsUrlForShop(normalized));
        }

        function renderShopSwitcherOptions(extraItems = []) {
            const optionsEl = document.getElementById('shop-switcher-options');
            if (!optionsEl) return;

            const options = getKnownShopOptions(extraItems);
            if (!options.length) {
                optionsEl.innerHTML = `
                    <div class="rounded-2xl border border-dashed border-[#3B3052] bg-[#171320] px-4 py-5 text-sm text-[#A792C0]">
                        No authorized stores are available for this session yet.
                    </div>
                `;
                return;
            }

            optionsEl.innerHTML = options.map((item) => {
                const isActive = item.shop === currentShopId;
                return `
                    <button
                        type="button"
                        class="flex w-full items-center justify-between rounded-2xl border px-3 py-3 text-left transition ${isActive ? 'border-[#5F4A84] bg-[#1C1628]' : 'border-transparent hover:border-[#3B3052] hover:bg-[#181321]'}"
                        data-shop-option="${escapeHtmlAttr(item.shop)}"
                        data-shop-type="${escapeHtmlAttr(item.type)}"
                    >
                        <span class="min-w-0 pr-3">
                            <span class="block truncate text-sm font-semibold text-[#F4ECFF]">${escapeHtml(item.shop)}</span>
                            <span class="mt-1 inline-flex items-center gap-2 text-xs text-[#A792C0]">
                                <span class="journey-chip text-[10px] px-2 py-0.5">${escapeHtml(item.type)}</span>
                                ${isActive ? '<span class="font-medium text-[#D8B4FE]">Active</span>' : '<span>Open analytics for this store</span>'}
                            </span>
                        </span>
                        <i class="fa-solid fa-arrow-up-right-from-square text-xs ${isActive ? 'text-[#D8B4FE]' : 'text-[#6E5A87]'}"></i>
                    </button>
                `;
            }).join('');

            optionsEl.querySelectorAll('[data-shop-option]').forEach((button) => {
                button.addEventListener('click', () => {
                    navigateToSelectedShop(
                        button.getAttribute('data-shop-option') || '',
                        button.getAttribute('data-shop-type') || ''
                    );
                });
            });
        }

        function initializeShopSwitcher() {
            const root = document.getElementById('shop-switcher');
            const button = document.getElementById('shop-switcher-button');
            if (!root || !button) return;

            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleShopSwitcher();
            });

            document.addEventListener('click', (event) => {
                if (!root.contains(event.target)) closeShopSwitcher();
            });

            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') closeShopSwitcher();
            });

            renderShopSwitcherOptions();
        }

        let activeTooltipTarget = null;
        let globalTooltipEl = null;

        function ensureGlobalTooltipEl() {
            if (globalTooltipEl && document.body.contains(globalTooltipEl)) return globalTooltipEl;
            globalTooltipEl = document.createElement('div');
            globalTooltipEl.id = 'adray-global-tooltip';
            globalTooltipEl.setAttribute('role', 'tooltip');
            document.body.appendChild(globalTooltipEl);
            return globalTooltipEl;
        }

        function positionGlobalTooltip(target) {
            const tooltip = ensureGlobalTooltipEl();
            if (!target) return;

            tooltip.style.left = '0px';
            tooltip.style.top = '0px';
            tooltip.style.visibility = 'hidden';
            tooltip.classList.add('is-visible');

            const rect = target.getBoundingClientRect();
            const pad = 10;
            const tooltipRect = tooltip.getBoundingClientRect();
            const maxLeft = Math.max(pad, window.innerWidth - tooltipRect.width - pad);
            const centeredLeft = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
            const left = Math.min(maxLeft, Math.max(pad, centeredLeft));

            let top = rect.top - tooltipRect.height - 10;
            if (top < pad) {
                top = Math.min(window.innerHeight - tooltipRect.height - pad, rect.bottom + 10);
            }

            tooltip.style.left = `${left}px`;
            tooltip.style.top = `${Math.max(pad, top)}px`;
            tooltip.style.visibility = 'visible';
        }

        function showGlobalTooltip(target) {
            const tooltipText = String(target?.getAttribute('data-tooltip') || '').trim();
            if (!tooltipText) return hideGlobalTooltip();
            activeTooltipTarget = target;
            const tooltip = ensureGlobalTooltipEl();
            tooltip.textContent = tooltipText;
            tooltip.classList.add('is-visible');
            positionGlobalTooltip(target);
        }

        function hideGlobalTooltip() {
            activeTooltipTarget = null;
            if (!globalTooltipEl) return;
            globalTooltipEl.classList.remove('is-visible');
            globalTooltipEl.style.visibility = 'hidden';
        }

        function initializeGlobalTooltipPortal() {
            if (document.body?.dataset?.adrayTooltipPortal === 'ready') return;
            ensureGlobalTooltipEl();
            if (document.body) {
                document.body.dataset.adrayTooltipPortal = 'ready';
                document.body.classList.add('tooltip-portal-ready');
            }

            document.addEventListener('mouseover', (event) => {
                const target = event.target instanceof Element ? event.target.closest('[data-tooltip]') : null;
                if (!target) return;
                showGlobalTooltip(target);
            });

            document.addEventListener('mouseout', (event) => {
                if (!activeTooltipTarget) return;
                const next = event.relatedTarget instanceof Element ? event.relatedTarget.closest('[data-tooltip]') : null;
                if (next === activeTooltipTarget) return;
                if (next) {
                    showGlobalTooltip(next);
                    return;
                }
                hideGlobalTooltip();
            });

            document.addEventListener('focusin', (event) => {
                const target = event.target instanceof Element ? event.target.closest('[data-tooltip]') : null;
                if (!target) return;
                showGlobalTooltip(target);
            });

            document.addEventListener('focusout', () => {
                hideGlobalTooltip();
            });

            document.addEventListener('scroll', () => {
                if (activeTooltipTarget) positionGlobalTooltip(activeTooltipTarget);
            }, true);

            window.addEventListener('resize', () => {
                if (activeTooltipTarget) positionGlobalTooltip(activeTooltipTarget);
            });
        }

        function resolvePublicShopId() {
            const fromUrl = getShopIdFromUrl();
            if (fromUrl) {
                persistCurrentShopId(fromUrl);
                return fromUrl;
            }

            const fromStorage = readStoredShopId();
            if (fromStorage) return fromStorage;

            return null;
        }

        // --- AUTH & INIT ---
        async function init() {
            initializeDateControls();
            initializeMetricCarousel();
            initializeShopSwitcher();
            initializeGlobalTooltipPortal();
            initializeLiveFeedScrollbar();
            setAnalyticsLoadingState(true, {
                mode: 'boot',
                title: 'Connecting your store',
                copy: 'Checking the active session and preparing the embedded attribution dashboard.',
            });

            // Check URL purely for overrides (for admins or explicit intent)
            const fromUrl = getShopIdFromUrl();
            const fromStorage = readStoredShopId();

            if (fromUrl) registerKnownShop(fromUrl, inferStoreTypeFromShopId(fromUrl));
            if (fromStorage) registerKnownShop(fromStorage, inferStoreTypeFromShopId(fromStorage));

            try {
                // Protect endpoint by looking for backend session first
                const res = await fetch('/api/session');
                const data = await res.json();
                logAnalyticsDebug('session response', {
                    ok: res.ok,
                    authenticated: !!data?.authenticated,
                    sessionShop: data?.user?.shop || null,
                    resolvedShop: data?.user?.resolvedShop || null,
                    authorizedAnalyticsShops: Array.isArray(data?.user?.authorizedAnalyticsShops)
                        ? data.user.authorizedAnalyticsShops.map((item) => item?.shop || null)
                        : [],
                });

                if (data.authenticated) {
                    const user = data.user || {};
                    const sessionShop = normalizeShopId(user.shop);
                    const sessionType = user.shopifyConnected ? 'shopify' : 'woocommerce';
                    const authorizedPayload = await fetchAuthorizedShopOptions();
                    const authorizedShops = Array.isArray(authorizedPayload.shops) ? authorizedPayload.shops : [];
                    const authorizedShopSet = new Set(
                        authorizedShops.map((item) => normalizeShopId(item.shop)).filter(Boolean)
                    );
                    const defaultAuthorizedShop = normalizeShopId(
                        authorizedPayload.defaultShop ||
                        authorizedShops.find((item) => item.isDefault)?.shop ||
                        ''
                    );

                    if (sessionShop) registerKnownShop(sessionShop, sessionType);
                    currentShopId = fromUrl || fromStorage || sessionShop || defaultAuthorizedShop;

                    if (authorizedShopSet.size && currentShopId && !authorizedShopSet.has(currentShopId)) {
                        logAnalyticsDebug('selected shop not authorized, falling back', {
                            fromUrl,
                            fromStorage,
                            sessionShop,
                            currentShopId,
                            defaultAuthorizedShop,
                            authorizedShops: authorizedShops.map((item) => item.shop),
                        });
                        currentShopId = defaultAuthorizedShop || sessionShop || '';
                    }
                    
                    if (!currentShopId) {
                        logAnalyticsDebug('no currentShopId after protected init', {
                            fromUrl,
                            fromStorage,
                            sessionShop,
                            defaultAuthorizedShop,
                            authorizedShops: authorizedShops.map((item) => item.shop),
                        });
                        updateShopHeader('Select store', 'store');
                        renderShopSwitcherOptions(authorizedShops.length ? authorizedShops : (sessionShop ? [{ shop: sessionShop, type: sessionType }] : []));
                        setAnalyticsLoadingState(false);
                        return;
                    }

                    const selectedShop = authorizedShops.find((item) => item.shop === currentShopId);
                    const inferredType = selectedShop?.type ||
                        (currentShopId === sessionShop ? sessionType : inferStoreTypeFromShopId(currentShopId));
                    
                    updateShopHeader(currentShopId, inferredType);
                    replaceCurrentShopInUrl(currentShopId);
                    notifyParentShopChanged(currentShopId, inferredType);
                    logAnalyticsDebug('protected analytics mode resolved', {
                        fromUrl,
                        fromStorage,
                        sessionShop,
                        defaultAuthorizedShop,
                        currentShopId,
                        inferredType,
                    });

                    connectLiveFeed();
                    startWordPressUsersPolling();
                    loadSessionExplorerOverview();
                    await fetchAnalytics();
                    return;
                }
            } catch (error) {
                console.warn('Session API failed:', error);
            }

            // Fallback: browser-known shop only
            currentShopId = resolvePublicShopId();

            if (currentShopId) {
                const inferredType = currentShopId.includes('.myshopify.com') ? 'shopify' : 'custom';
                updateShopHeader(currentShopId, inferredType);
                replaceCurrentShopInUrl(currentShopId);
                notifyParentShopChanged(currentShopId, inferredType);
                logAnalyticsDebug('public fallback mode resolved', {
                    currentShopId,
                    inferredType,
                });
                connectLiveFeed();
                startWordPressUsersPolling();
                loadSessionExplorerOverview();
                await fetchAnalytics();
            } else {
                logAnalyticsDebug('public fallback mode has no shop', {
                    fromUrl,
                    fromStorage,
                });
                updateShopHeader('Select store', 'store');
                renderShopSwitcherOptions();
                setAnalyticsLoadingState(false);
            }
        }

        function startWordPressUsersPolling() {
            if (!currentShopId) return;
            if (wpUsersPollTimer) {
                clearInterval(wpUsersPollTimer);
            }
            fetchWordPressUsersOnline();
            wpUsersPollTimer = setInterval(() => {
                if (document.hidden) return;
                fetchWordPressUsersOnline();
            }, WP_USERS_POLL_INTERVAL_MS);

            if (!window.__adrayVisibilityPollingBound) {
                document.addEventListener('visibilitychange', () => {
                    if (!document.hidden) {
                        fetchWordPressUsersOnline();
                    }
                });
                window.__adrayVisibilityPollingBound = true;
            }
        }

        function renderWordPressUsersOnlineState({ countText, statusText, statusClass, users = [] }) {
            const countEl = document.getElementById('wp-online-count');
            const statusEl = document.getElementById('wp-online-status');
            const listEl = document.getElementById('wp-online-list');
            if (!countEl || !statusEl || !listEl) return;

            countEl.textContent = countText;
            statusEl.className = `text-xs ${statusClass}`;
            statusEl.textContent = statusText;
            statusEl.style.display = statusText ? '' : 'none';

            if (!users.length) {
                listEl.innerHTML = '';
                return;
            }

            const palette = ['is-a', 'is-b', 'is-c', 'is-d'];
            listEl.innerHTML = users.map((user) => {
                const colorClass = palette[Math.abs(hashString(user.id || user.customerId || user.customerName || 'x')) % palette.length];
                const displayName = user.customerName || (user.customerId ? `Customer #${user.customerId}` : 'Unnamed user');
                const secondary = user.emailPreview || user.phonePreview || `ID: ${user.id}`;
                const seenAt = user.lastSeenAt ? formatTimeMx(user.lastSeenAt) : '-';
                const sessionText = Number(user.sessionCount || 0) > 0 ? `${user.sessionCount}s` : '0s';
                const userKey = resolveUserKeyFromOnlineUser(user);
                const sessionId = resolvePrimarySessionIdFromOnlineUser(user);

                return `
                    <button
                        type="button"
                        class="wp-user-pill ${colorClass} cursor-pointer hover:opacity-95"
                        style="width:100%;text-align:left;"
                        data-user-key="${escapeHtmlAttr(userKey)}"
                        data-session-id="${escapeHtmlAttr(sessionId)}"
                        data-customer-id="${escapeHtmlAttr(user.customerId || '')}"
                        data-user-name="${escapeHtmlAttr(displayName)}"
                    >
                        <p class="wp-user-name truncate">${displayName}</p>
                        <div class="wp-user-extra">
                            <p class="wp-user-meta truncate">${secondary}</p>
                            <p class="wp-user-session mt-1">${sessionText} · ${seenAt}</p>
                        </div>
                    </button>
                `;
            }).join('');

            listEl.querySelectorAll('.wp-user-pill').forEach((button) => {
                button.addEventListener('click', () => {
                    const selectedUserKey = button.getAttribute('data-user-key') || '';
                    const selectedCustomerId = button.getAttribute('data-customer-id') || '';
                    const selectedUserName = button.getAttribute('data-user-name') || 'User';
                    focusJourneyProfile({
                        userKey: selectedUserKey,
                        customerId: selectedCustomerId,
                        fallbackName: selectedUserName,
                    });
                });
            });
        }

        function hashString(value) {
            const str = String(value || '');
            let hash = 0;
            for (let i = 0; i < str.length; i += 1) {
                hash = ((hash << 5) - hash) + str.charCodeAt(i);
                hash |= 0;
            }
            return hash;
        }

        function escapeHtmlAttr(value) {
            return String(value || '')
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        }

        function resolveUserKeyFromOnlineUser(user = {}) {
            const idValue = String(user.id || '').trim();
            if (idValue.startsWith('user:')) return idValue.slice(5);

            const explicitUserKey = String(user.userKey || '').trim();
            if (explicitUserKey) return explicitUserKey;

            return '';
        }

        function resolvePrimarySessionIdFromOnlineUser(user = {}) {
            const sessions = Array.isArray(user.sessionIds) ? user.sessionIds : [];
            const first = String(sessions[0] || '').trim();
            return first || '';
        }

        function mapStoreTypeLabel(rawType) {
            const value = String(rawType || '').trim().toLowerCase();
            if (!value) return 'Store';
            if (value.includes('shopify') || value.includes('myshopify')) return 'Shopify';
            if (value.includes('woo') || value.includes('wordpress')) return 'WooCommerce';
            if (value.includes('magento')) return 'Magento';
            if (value.includes('custom')) return 'Custom';
            return value.charAt(0).toUpperCase() + value.slice(1);
        }

        function inferStoreTypeFromShopId(shopName = '') {
            const value = String(shopName || '').toLowerCase();
            if (value.includes('.myshopify.com')) return 'Shopify';
            return 'WooCommerce';
        }

        function resolveEffectiveStoreType(rawType, shopName = '') {
            const mapped = mapStoreTypeLabel(rawType);
            if (mapped !== 'Custom' && mapped !== 'Store') return mapped;

            if (storeTypeSignals.sawWordPressEndpoint || storeTypeSignals.sawWordPressUsers) return 'WooCommerce';
            if (String(shopName || '').toLowerCase().includes('.myshopify.com')) return 'Shopify';
            if (currentStoreTypeLabel && currentStoreTypeLabel !== 'Custom' && currentStoreTypeLabel !== 'Store') return currentStoreTypeLabel;
            return inferStoreTypeFromShopId(shopName);
        }

        function updateShopHeader(shopName, rawType) {
            const shopEl = document.getElementById('shop-name');
            const typeEl = document.getElementById('shop-type-badge');
            if (shopEl) shopEl.textContent = shopName || 'Select store';

            if (rawType) currentStoreTypeLabel = resolveEffectiveStoreType(rawType, shopName || currentShopId || '');
            if (typeEl) typeEl.textContent = currentStoreTypeLabel;

            if (shopName && shopName !== 'Select store') {
                registerKnownShop(shopName, currentStoreTypeLabel);
                persistCurrentShopId(shopName);
            }

            renderShopSwitcherOptions(
                shopName && shopName !== 'Select store'
                    ? [{ shop: shopName, type: currentStoreTypeLabel }]
                    : []
            );
        }

        function humanReadablePersonName(rawName, fallback = 'Cliente') {
            const value = String(rawName || '').trim();
            if (!value || value === '-') return fallback;

            const source = value.includes('@') ? value.split('@')[0] : value;
            const clean = source.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
            if (!clean) return fallback;

            const first = clean.split(' ')[0] || fallback;
            return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
        }

        function normalizeAttributionToken(value) {
            return String(value || '')
                .trim()
                .toLowerCase()
                .replace(/[_-]+/g, ' ')
                .replace(/\s+/g, ' ');
        }

        function toTitleCaseWords(value = '') {
            return String(value || '')
                .split(' ')
                .filter(Boolean)
                .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                .join(' ');
        }

        function humanizeAttributionPlatform(platform = '') {
            const normalized = normalizeAttributionToken(platform);
            if (!normalized || normalized === '-' || normalized === 'none' || normalized === 'direct') return '';

            if (normalized.includes('google')) return 'Google';
            if (normalized.includes('facebook') || normalized.includes('instagram') || normalized.includes('meta')) return 'Meta';
            if (normalized.includes('tiktok')) return 'TikTok';
            if (normalized.includes('yahoo')) return 'Yahoo';
            if (normalized.includes('bing')) return 'Bing';
            if (normalized.includes('duckduckgo')) return 'DuckDuckGo';
            if (normalized.includes('hostinger')) return 'Hostinger';
            if (normalized.includes('klaviyo')) return 'Klaviyo';
            if (normalized.includes('mailchimp')) return 'Mailchimp';
            if (normalized.includes('hubspot')) return 'HubSpot';
            if (normalized.includes('linkedin')) return 'LinkedIn';
            if (normalized.includes('pinterest')) return 'Pinterest';
            if (normalized.includes('whatsapp')) return 'WhatsApp';
            if (normalized.includes('referral')) return 'Referral';

            const hostLike = normalized
                .replace(/^https?:\/\//, '')
                .replace(/^www\./, '')
                .split('/')[0]
                .trim();
            const base = (hostLike.split('.')[0] || normalized).replace(/[-_]+/g, ' ');
            return toTitleCaseWords(base);
        }

        function humanReadableChannel(channel, platform = '') {
            const value = normalizeAttributionToken(channel);
            const platformLabel = humanizeAttributionPlatform(platform);
            if (!value) return 'Channel';
            if (value === 'unattributed' || value === 'none') return 'Unattributed';
            if (value === 'multi touch') return 'Multi-touch';
            if (value.includes('meta') || value.includes('facebook') || value.includes('instagram')) return 'Meta Ads';
            if (value === 'google') return 'Google Ads';
            if (value === 'paid search' || value === 'cpc' || value === 'ppc') return platformLabel ? `${platformLabel} Ads` : 'Paid Search';
            if (value.includes('tiktok')) return 'TikTok Ads';
            if (value === 'organic search') return platformLabel ? `${platformLabel} Search` : 'Organic Search';
            if (value === 'organic social') return platformLabel ? `${platformLabel} Organic` : 'Organic Social';
            if (value === 'organic') return platformLabel ? `${platformLabel} Organic` : 'Organic';
            if (value === 'direct') return 'Direct';
            if (value === 'referral') return platformLabel ? `${platformLabel} Referral` : 'Referral';
            if (value === 'email') return platformLabel ? `${platformLabel} Email` : 'Email';
            if (value === 'other') return platformLabel ? `${platformLabel} Other` : 'Other';
            return toTitleCaseWords(value);
        }

        function humanReadableSessionLabel({ linkedUserLabel = '', sessionId = '' } = {}) {
            const person = humanReadablePersonName(linkedUserLabel || '', 'Customer');
            if (linkedUserLabel) return `Session for ${person}`;
            if (sessionId) return 'Active session';
            return 'Session';
        }

        function normalizeAttributionChannel(channel, platform = '') {
            const value = normalizeAttributionToken(channel);
            const platformValue = normalizeAttributionToken(platform);
            const combined = `${value} ${platformValue}`.trim();
            if (!combined || value === 'unattributed' || value === 'none') return 'unattributed';
            if (combined.includes('tiktok') || combined.includes('ttclid')) return 'tiktok';
            if (/(facebook|instagram|meta|fbclid)/.test(combined)) return 'meta';
            if (/(google|adwords|gclid)/.test(combined)) return 'google';
            if (value === 'paid search' || value === 'cpc' || value === 'ppc') return platformValue.includes('google') ? 'google' : 'other';
            if (value === 'paid social') {
                if (platformValue.includes('tiktok')) return 'tiktok';
                if (/(facebook|instagram|meta)/.test(platformValue)) return 'meta';
                return 'other';
            }
            if (value === 'organic search' || value === 'organic social') return 'organic';
            if (/(organic|seo|direct|referral|email|newsletter|klaviyo|mailchimp|sendgrid|brevo|hubspot|activecampaign|convertkit|yahoo|bing|duckduckgo|baidu|hostinger|linktr|affiliate|partner|whatsapp|sms)/.test(combined)) return 'organic';
            return value === 'other' ? 'other' : 'other';
        }

        function resolvePurchaseCustomerName(purchase = {}) {
            const candidates = [
                purchase.customerName,
                purchase.customerDisplayName,
                purchase.displayName,
                purchase.billingName,
                purchase.shippingName,
                [purchase.billingFirstName, purchase.billingLastName].filter(Boolean).join(' ').trim(),
                [purchase.customerFirstName, purchase.customerLastName].filter(Boolean).join(' ').trim(),
                [purchase.firstName, purchase.lastName].filter(Boolean).join(' ').trim(),
                purchase.customerEmail,
                purchase.email,
            ];

            const hit = candidates.find((value) => String(value || '').trim());
            return String(hit || '').trim();
        }

        function resolvePurchaseCustomerEmail(purchase = {}) {
            const directCandidates = [
                purchase.customerEmail,
                purchase.email,
                purchase.billingEmail,
                purchase.shippingEmail,
                purchase.userEmail,
            ];

            const directHit = directCandidates.find((value) => String(value || '').trim());
            if (directHit) return String(directHit || '').trim().toLowerCase();

            const events = Array.isArray(purchase.events) ? purchase.events : [];
            for (const event of events) {
                const eventCandidates = [
                    event?.customerEmail,
                    event?.email,
                    event?.userEmail,
                    event?.payload?.customerEmail,
                    event?.payload?.customer_email,
                    event?.payload?.email,
                    event?.payload?.user_email,
                    event?.rawPayload?.customerEmail,
                    event?.rawPayload?.customer_email,
                    event?.rawPayload?.email,
                    event?.rawPayload?.user_email,
                ];
                const eventHit = eventCandidates.find((value) => String(value || '').trim());
                if (eventHit) return String(eventHit || '').trim().toLowerCase();
            }

            return '';
        }

        function resolvePurchaseDisplayIdentity(purchase = {}) {
            const rawName = String(resolvePurchaseCustomerName(purchase) || '').trim();
            const rawEmail = String(resolvePurchaseCustomerEmail(purchase) || '').trim();

            let cleanName = rawName;
            if (cleanName && !cleanName.includes('@')) {
                cleanName = cleanName.replace(/^.*?\bfor\s+/i, '').trim();
                cleanName = cleanName.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
                cleanName = toTitleCaseWords(cleanName.toLowerCase());
            }

            if (!cleanName && rawEmail) {
                cleanName = toTitleCaseWords(rawEmail.split('@')[0].replace(/[._-]+/g, ' ').trim().toLowerCase());
            }

            return {
                name: cleanName || 'Customer',
                email: rawEmail,
            };
        }

        function resolveOnlineUserIdentity({ sessionId = null, userKey = null } = {}) {
            const users = Array.isArray(wpUsersOnlineState?.users) ? wpUsersOnlineState.users : [];
            if (!users.length) return { label: null, userKey: '', sessionId: '' };

            const normalizedSessionId = String(sessionId || '').trim();
            const normalizedUserKey = String(userKey || '').trim();

            const bySession = normalizedSessionId
                ? users.find((user) => Array.isArray(user.sessionIds) && user.sessionIds.includes(normalizedSessionId))
                : null;

            const byUserKey = !bySession && normalizedUserKey
                ? users.find((user) => String(user.id || '').trim() === `user:${normalizedUserKey}`)
                : null;

            const matchedUser = bySession || byUserKey || null;
            if (!matchedUser) return { label: null, userKey: normalizedUserKey, sessionId: normalizedSessionId };

            return {
                label: matchedUser.customerName
                    || matchedUser.emailPreview
                    || matchedUser.phonePreview
                    || (matchedUser.customerId ? `Woo #${matchedUser.customerId}` : null),
                userKey: resolveUserKeyFromOnlineUser(matchedUser) || normalizedUserKey,
                sessionId: resolvePrimarySessionIdFromOnlineUser(matchedUser) || normalizedSessionId,
            };
        }

        function buildIdentityLabel({ customerName = '', customerId = '', email = '', phone = '' } = {}) {
            const normalizedName = String(customerName || '').trim();
            if (normalizedName) return normalizedName;
            const normalizedEmail = String(email || '').trim();
            if (normalizedEmail) return normalizedEmail;
            const normalizedPhone = String(phone || '').trim();
            if (normalizedPhone) return normalizedPhone;
            const normalizedCustomerId = String(customerId || '').trim();
            if (normalizedCustomerId) return `Woo #${normalizedCustomerId}`;
            return null;
        }

        function mergeLiveFeedIdentity(base = {}, incoming = {}) {
            return {
                customerId: String(base.customerId || incoming.customerId || '').trim(),
                userKey: String(base.userKey || incoming.userKey || '').trim(),
                sessionId: String(base.sessionId || incoming.sessionId || '').trim(),
                customerName: String(base.customerName || incoming.customerName || '').trim(),
                email: String(base.email || incoming.email || '').trim(),
                phone: String(base.phone || incoming.phone || '').trim(),
            };
        }

        function cacheLiveFeedIdentity(identity = {}) {
            const enriched = mergeLiveFeedIdentity({}, identity);
            const hasSignal = enriched.customerId || enriched.userKey || enriched.sessionId || enriched.customerName || enriched.email || enriched.phone;
            if (!hasSignal) return;

            if (enriched.sessionId) {
                const prev = liveFeedIdentityState.bySessionId.get(enriched.sessionId) || {};
                liveFeedIdentityState.bySessionId.set(enriched.sessionId, mergeLiveFeedIdentity(prev, enriched));
            }
            if (enriched.userKey) {
                const prev = liveFeedIdentityState.byUserKey.get(enriched.userKey) || {};
                liveFeedIdentityState.byUserKey.set(enriched.userKey, mergeLiveFeedIdentity(prev, enriched));
            }
            if (enriched.customerId) {
                const prev = liveFeedIdentityState.byCustomerId.get(enriched.customerId) || {};
                liveFeedIdentityState.byCustomerId.set(enriched.customerId, mergeLiveFeedIdentity(prev, enriched));
            }
        }

        function resolveLiveFeedIdentity({ sessionId = null, userKey = null, payload = {} } = {}) {
            const safeSessionId = String(sessionId || '').trim();
            const safeUserKey = String(userKey || '').trim();
            const normalizedPayload = payload && typeof payload === 'object' ? payload : {};

            const payloadCustomerId = String(
                normalizedPayload.customer_id
                || normalizedPayload.customerId
                || normalizedPayload?.customer?.id
                || ''
            ).trim();
            const payloadName = String(
                normalizedPayload.customer_name
                || normalizedPayload.customer_display_name
                || normalizedPayload.customerName
                || normalizedPayload.customerDisplayName
                || [normalizedPayload.customer_first_name, normalizedPayload.customer_last_name].filter(Boolean).join(' ')
                || [normalizedPayload.customerFirstName, normalizedPayload.customerLastName].filter(Boolean).join(' ')
                || [normalizedPayload.first_name, normalizedPayload.last_name].filter(Boolean).join(' ')
                || [normalizedPayload.firstName, normalizedPayload.lastName].filter(Boolean).join(' ')
                || normalizedPayload?.customer?.name
                || normalizedPayload?.customer?.display_name
                || normalizedPayload?.user_data?.name
                || [normalizedPayload?.user_data?.fn, normalizedPayload?.user_data?.ln].filter(Boolean).join(' ')
                || [normalizedPayload?.billing?.first_name, normalizedPayload?.billing?.last_name].filter(Boolean).join(' ')
                || [normalizedPayload?.customer?.first_name, normalizedPayload?.customer?.last_name].filter(Boolean).join(' ')
                || ''
            ).trim();
            const payloadEmail = String(normalizedPayload.email || normalizedPayload.customer_email || normalizedPayload?.user_data?.email || normalizedPayload?.billing?.email || normalizedPayload?.customer?.email || '').trim();
            const payloadPhone = String(normalizedPayload.phone || normalizedPayload.customer_phone || normalizedPayload?.user_data?.phone || '').trim();

            const onlineIdentity = resolveOnlineUserIdentity({ sessionId: safeSessionId, userKey: safeUserKey });
            const onlineLabel = String(onlineIdentity?.label || '').trim();

            const candidate = mergeLiveFeedIdentity(
                {},
                {
                    sessionId: safeSessionId || onlineIdentity?.sessionId || '',
                    userKey: safeUserKey || onlineIdentity?.userKey || '',
                    customerId: payloadCustomerId,
                    customerName: payloadName || onlineLabel,
                    email: payloadEmail,
                    phone: payloadPhone,
                }
            );

            const bySession = candidate.sessionId ? (liveFeedIdentityState.bySessionId.get(candidate.sessionId) || {}) : {};
            const byUser = candidate.userKey ? (liveFeedIdentityState.byUserKey.get(candidate.userKey) || {}) : {};
            const byCustomer = candidate.customerId ? (liveFeedIdentityState.byCustomerId.get(candidate.customerId) || {}) : {};
            const merged = mergeLiveFeedIdentity(mergeLiveFeedIdentity(bySession, byUser), mergeLiveFeedIdentity(byCustomer, candidate));

            const label = buildIdentityLabel({
                customerName: merged.customerName,
                customerId: merged.customerId,
                email: merged.email,
                phone: merged.phone,
            });

            cacheLiveFeedIdentity({
                ...merged,
                customerName: merged.customerName || label || '',
            });

            return {
                label,
                sessionId: merged.sessionId || candidate.sessionId || safeSessionId,
                userKey: merged.userKey || candidate.userKey || safeUserKey,
                customerId: merged.customerId || payloadCustomerId || '',
                email: merged.email || '',
                phone: merged.phone || '',
            };
        }
        function renderProfilePriorityBanner(mode = 'overview', payload = {}) {
            const el = document.getElementById('profile-priority-banner');
            if (!el) return;

            const connectedCount = Number((wpUsersOnlineState.users || []).length || 0);
            const connectedNames = (wpUsersOnlineState.users || []).slice(0, 2)
                .map((u) => u.customerName || u.emailPreview || `#${u.customerId || '?'}`)
                .filter(Boolean)
                .join(' · ');

            if (mode === 'session') {
                const profile = payload.profile || {};
                const metrics = payload.metrics || {};
                const compareHint = payload.patterns?.recommendedComparison?.sessionId
                    ? `Suggested comparison: ${payload.patterns.recommendedComparison.sessionId}`
                    : 'Open a related session to compare behavior.';

                el.innerHTML = `
                    <p class="focus-title">Profile + Session Priority</p>
                    <p class="focus-copy">This is the most critical part of the dashboard: identify the profile, see what they buy, and compare their journey against other sessions.</p>
                    <div class="profile-focus-grid">
                        <div class="profile-focus-pill">
                            <p class="label">Current Profile</p>
                            <p class="value">${profile.profileLabel || '-'}</p>
                        </div>
                        <div class="profile-focus-pill">
                            <p class="label">Profile orders</p>
                            <p class="value">${profile.historicalOrderCount || 0}</p>
                        </div>
                        <div class="profile-focus-pill">
                            <p class="label">Related sessions</p>
                            <p class="value">${payload.patterns?.peerSessionCount || 0}</p>
                        </div>
                    </div>
                    <p class="focus-copy">${compareHint}</p>
                    <p class="focus-copy">Connected now: ${connectedCount}${connectedNames ? ` · ${connectedNames}` : ''}.</p>
                `;
                return;
            }

            const summary = payload.summary || {};
            const profiles = Array.isArray(payload.profiles) ? payload.profiles : [];
            const topBuyers = profiles
                .slice()
                .sort((a, b) => Number(b.totalRevenue || 0) - Number(a.totalRevenue || 0))
                .slice(0, 2)
                .map((p) => `${p.profileLabel || 'Profile'} (${formatCurrency(p.totalRevenue || 0)})`)
                .join(' · ');

            el.innerHTML = `
                <p class="focus-title">Profile Center</p>
                <p class="focus-copy">Focus here for business decisions: who is connected now, what they usually buy, and how they compare against historical profiles.</p>
                <div class="profile-focus-grid">
                    <div class="profile-focus-pill">
                        <p class="label">Connected now</p>
                        <p class="value">${connectedCount}</p>
                    </div>
                    <div class="profile-focus-pill">
                        <p class="label">Historical profiles</p>
                        <p class="value">${summary.totalProfiles || 0}</p>
                    </div>
                    <div class="profile-focus-pill">
                        <p class="label">Historical revenue</p>
                        <p class="value">${formatCurrency(summary.totalRevenue || 0)}</p>
                    </div>
                </div>
                <p class="focus-copy">Top buyers: ${topBuyers || 'Not enough data yet.'}</p>
                <p class="focus-copy">Detected connected users: ${connectedNames || (wpUsersOnlineState.hasError ? 'Error checking online status.' : 'No recently connected users.')}</p>
            `;
        }

        function renderActionCards(recommendations = []) {
            if (!Array.isArray(recommendations) || !recommendations.length) {
                return '<p class="text-sm text-gray-500">There are no actionable recommendations yet.</p>';
            }

            return recommendations.slice(0, 2).map((item) => `
                <div class="session-pattern-item rounded-xl p-4">
                    <p class="text-sm font-semibold text-gray-900">${item.title || 'Recommendation'}</p>
                    <p class="mt-1 text-sm text-gray-600">${item.detail || '-'}</p>
                    <p class="session-positive-copy mt-2 text-xs font-medium uppercase tracking-wide">Immediate action</p>
                    <p class="session-positive-copy text-sm">${item.action || '-'}</p>
                </div>
            `).join('');
        }

        function renderAffinityCards(topProducts = [], topPairings = []) {
            const productHtml = Array.isArray(topProducts) && topProducts.length
                ? topProducts.slice(0, 3).map((item) => `
                    <div class="session-side-card rounded-xl p-4">
                        <p class="text-sm font-semibold text-gray-900">${item.name || 'Product'}</p>
                        <p class="mt-1 text-sm text-gray-600">${item.orderCount || 0} orders · ${item.units || 0} units · ${formatCurrency(item.revenue || 0)}</p>
                    </div>
                `).join('')
                : '<p class="text-sm text-gray-500">Not enough purchase affinity yet.</p>';

            const pairingHtml = Array.isArray(topPairings) && topPairings.length
                ? `
                    <div class="session-side-card rounded-xl p-4">
                        <p class="text-xs font-semibold uppercase tracking-wide text-gray-500">Likely bundles</p>
                        <div class="mt-2 space-y-1 text-sm text-gray-600">
                            ${topPairings.slice(0, 2).map((pair) => `<p>${pair.primary} + ${pair.secondary} · ${pair.orders} orders</p>`).join('')}
                        </div>
                    </div>
                `
                : '';

            return `${productHtml}${pairingHtml}`;
        }

        function escapeHtml(value) {
            return String(value || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        function resolveEventIcon(eventNameRaw) {
            const name = String(eventNameRaw || '').toLowerCase();
            if (name.includes('page_view') || name === 'pageview') return 'fa-solid fa-eye';
            if (name.includes('view_item') || name === 'view item') return 'fa-solid fa-box-open';
            if (name.includes('add_to_cart') || name === 'add to cart') return 'fa-solid fa-cart-shopping';
            if (name.includes('begin_checkout') || name === 'begin checkout') return 'fa-solid fa-credit-card';
            if (name.includes('purchase')) return 'fa-solid fa-bag-shopping';
            if (name.includes('login') || name === 'user_logged_in') return 'fa-solid fa-user-check';
            if (name.includes('lead') || name === 'generate_lead') return 'fa-solid fa-envelope-open-text';
            return 'fa-solid fa-globe';
        }

        function resolveChannelIcon(channel, platform) {
            const key = String(channel + ' ' + platform).toLowerCase();        
            if (key.includes('organic') || key.includes('referral') || key.includes('direct')) return 'fa-solid fa-globe';
            if (key.includes('google') || key.includes('search')) return 'fa-brands fa-google';
            if (key.includes('facebook') || key.includes('meta') || key.includes('instagram')) return 'fa-brands fa-meta';
            if (key.includes('tiktok')) return 'fa-brands fa-tiktok';
            if (key.includes('email')) return 'fa-solid fa-envelope';
            return 'fa-solid fa-bullseye';
        }

        function resolveChannelTone(channel, platform) {
            const rawChannel = String(channel || '').trim().toLowerCase();
            const normalizedChannel = normalizeAttributionChannel(rawChannel, platform || '');
            if (rawChannel.includes('other') || rawChannel.includes('unattributed')) return '';
            if (normalizedChannel === 'organic') return 'is-organic';
            if (normalizedChannel === 'google') return 'is-google';
            if (normalizedChannel === 'meta') return 'is-meta';
            if (normalizedChannel === 'tiktok') return 'is-tiktok';

            const rawPlatform = String(platform || '').trim().toLowerCase();
            const normalizedPlatform = normalizeAttributionChannel(rawPlatform, rawChannel);
            if (normalizedPlatform === 'organic') return 'is-organic';
            if (normalizedPlatform === 'google') return 'is-google';
            if (normalizedPlatform === 'meta') return 'is-meta';
            if (normalizedPlatform === 'tiktok') return 'is-tiktok';
            return '';
        }

        function scoreJourneySignal(purchase = {}) {
            let score = 0;
            if (purchase.attributedClickId) score += 5;
            if (purchase.attributedCampaign) score += 4;
            if (purchase.attributedChannel && purchase.attributedChannel !== 'unattributed') score += 3;
            if (purchase.attributedPlatform) score += 2;
            if (typeof purchase.attributionConfidence === 'number') score += Math.round(purchase.attributionConfidence * 3);
            if (Array.isArray(purchase.attributionSplits) && purchase.attributionSplits.length > 1) score += 2;
            return score;
        }

        function normalizeJourneyPath(urlLike) {
            if (!urlLike) return '-';
            try {
                return new URL(urlLike, window.location.origin).pathname || '-';
            } catch (_) {
                return String(urlLike);
            }
        }

        function dedupeAdjacentIdenticalEvents(eventsArray = []) {
            if (!Array.isArray(eventsArray) || eventsArray.length === 0) return [];
            const result = [];
            let current = eventsArray[0];
            for (let i = 1; i < eventsArray.length; i++) {
                const ev = eventsArray[i];
                const nameCurrent = String(current.eventName || current.name || '').toLowerCase();
                const nameNext = String(ev.eventName || ev.name || '').toLowerCase();
                const pathCurrent = normalizeJourneyPath(current.pageUrl || current.url || current.landingPageUrl || '');
                const pathNext = normalizeJourneyPath(ev.pageUrl || ev.url || ev.landingPageUrl || '');
                
                // If the event has the same name and exactly the same path as the previous one, skip it and keep the original event as the retained step
                if (nameCurrent === nameNext && pathCurrent === pathNext) {
                    continue; 
                }
                
                result.push(current);
                current = ev;
            }
            result.push(current);
            return result;
        }

        function deriveJourneySignalsFromEvents(events = []) {
            const signal = { lead: 0, call: 0 };
            if (!Array.isArray(events) || !events.length) return signal;

            events.forEach((event) => {
                const name = String(event.eventName || event.name || '').toLowerCase();
                if (/lead|form|contact|registro|signup/.test(name)) signal.lead += 1;
                if (/call|book|calendar|agendar|appointment/.test(name)) signal.call += 1;
            });

            return signal;
        }

        function normalizeEventNameHuman(rawName = '') {
            const key = String(rawName || '').trim().toLowerCase();
            if (key === 'page_view') return 'Page View';
            if (key === 'view_item') return 'View Product';
            if (key === 'add_to_cart') return 'Add to Cart';
            if (key === 'begin_checkout') return 'Begin Checkout';
            if (isPurchaseJourneyEventName(key)) return 'Purchase';
            if (key === 'user_logged_in' || key === 'user_login' || key === 'login') return 'Login';
            if (key === 'lead' || key === 'generate_lead') return 'Lead';
            return key ? key.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()) : 'Event';
        }

        function isPurchaseJourneyEventName(rawName = '') {
            const key = String(rawName || '').trim().toLowerCase();
            return ['purchase', 'order_completed', 'checkout_completed', 'order_create', 'orders_create'].includes(key);
        }

        function formatDurationCompact(seconds) {
            const value = Number(seconds || 0);
            if (!Number.isFinite(value) || value <= 0) return '<1s';
            if (value < 60) return `${Math.round(value)}s`;
            const mins = Math.floor(value / 60);
            const secs = Math.round(value % 60);
            return `${mins}m ${secs}s`;
        }

        function condenseSessionEvents(sorted = []) {
            if (!Array.isArray(sorted) || sorted.length <= 14) {
                return { events: sorted, dropped: 0 };
            }

            const keyEventNames = new Set([
                'view_item',
                'add_to_cart',
                'begin_checkout',
                'purchase',
                'order_completed',
                'checkout_completed',
                'order_create',
                'orders_create',
                'user_logged_in',
                'user_login',
                'login',
                'lead',
                'generate_lead'
            ]);
            const selectedIndexes = new Set([0, sorted.length - 1]);
            const pageViewIndexes = [];

            sorted.forEach((event, index) => {
                const eventName = String(event.eventName || event.name || '').toLowerCase();
                if (eventName === 'page_view') {
                    pageViewIndexes.push(index);
                    return;
                }
                if (keyEventNames.has(eventName)) selectedIndexes.add(index);
            });

            if (pageViewIndexes.length) {
                selectedIndexes.add(pageViewIndexes[0]);
                selectedIndexes.add(pageViewIndexes[pageViewIndexes.length - 1]);
                if (pageViewIndexes.length > 2) {
                    selectedIndexes.add(pageViewIndexes[Math.floor(pageViewIndexes.length / 2)]);
                }
            }

            const ordered = Array.from(selectedIndexes)
                .sort((a, b) => a - b)
                .map((index) => sorted[index]);

            let compact = ordered;
            if (ordered.length > 14) {
                compact = [...ordered.slice(0, 10), ...ordered.slice(-4)];
            }

            const dropped = Math.max(0, sorted.length - compact.length);
            if (!dropped) return { events: compact, dropped: 0 };

            const insertAt = Math.max(1, compact.length - 1);
            const summaryEvent = {
                eventName: '__condensed__',
                createdAt: compact[insertAt - 1]?.createdAt || compact[insertAt - 1]?.collectedAt || null,
                _ts: compact[insertAt - 1]?._ts || Date.now(),
                _sessionGroupIndex: compact[insertAt - 1]?._sessionGroupIndex,
                _detailLines: [`Skipped ${dropped} low-signal events to keep this readable.`],
            };

            const withSummary = [...compact.slice(0, insertAt), summaryEvent, ...compact.slice(insertAt)];
            return { events: withSummary, dropped };
        }

        function buildSessionTimelineEvents(sessionData = {}, options = {}) {
            const session = sessionData.session || {};
            const events = Array.isArray(sessionData.events) ? sessionData.events : (Array.isArray(sessionData.timeline) ? sessionData.timeline : []);
            if (!events.length) return [];
            const mode = String(options.mode || 'condensed').toLowerCase();

            const sortedRaw = events
                .map((event) => ({
                    ...event,
                    _ts: new Date(event.createdAt || event.collectedAt || session.startedAt || 0).getTime(),
                }))
                .filter((event) => Number.isFinite(event._ts))
                .sort((a, b) => a._ts - b._ts);
                
            const sorted = dedupeAdjacentIdenticalEvents(sortedRaw);

            const visible = mode === 'full' ? sorted : condenseSessionEvents(sorted).events;

            return visible.map((event, index) => {
                if (event.eventName === '__condensed__') {
                    return {
                        icon: 'fa-solid fa-filter',
                        title: 'Condensed events',
                        time: '-',
                        detailLines: event._detailLines || [],
                        tone: '',
                    };
                }

                const next = visible[index + 1];
                const nextTs = next?.eventName === '__condensed__' ? null : next?._ts;
                const durSeconds = nextTs
                    ? Math.max(0, (nextTs - event._ts) / 1000)
                    : Math.max(0, Number(session.sessionDurationSeconds || 0) - ((event._ts - visible[0]._ts) / 1000));
                const pagePath = normalizeJourneyPath(event.pageUrl || event.url || event.landingPageUrl || '');
                const itemName = event.productName || event.productId || event.itemId || '';
                const tone = resolveChannelTone(event.utmSource || session.utmSource, sessionData?.journey?.attribution?.platform || session.utmSource);

                const detailLines = [
                    pagePath && pagePath !== '-' ? `Page: ${pagePath}` : '',
                    itemName ? `Item: ${itemName}` : '',
                ].filter(Boolean);

                let baseTitle = normalizeEventNameHuman(event.eventName || event.name);
                let originalEventName = baseTitle;
                const rawName = String(event.eventName || event.name || '').toLowerCase();
                if (rawName === 'page_view' && pagePath && pagePath !== '-') {
                    baseTitle = pagePath.replace(/^\/|\/$/g, '') || 'home';
                }

                const timeStr = formatDateTimeMx(event.createdAt || event.collectedAt || null);
                let displayTime = timeStr;
                if (index > 0) {
                    const prev = visible[index - 1];
                    const prevTimeStr = formatDateTimeMx(prev.createdAt || prev.collectedAt || null);
                    if (timeStr === prevTimeStr) {
                        displayTime = '...';
                    }
                }

                return {
                    icon: resolveEventIcon(event.eventName || event.name),
                    title: durSeconds > 0 ? `${baseTitle} <span class="text-gray-400 text-[0.8rem]" style="margin-left: 0.5rem; font-weight: 500;">${formatDurationCompact(durSeconds)}</span>` : baseTitle,
                    time: displayTime,
                    fullTime: timeStr,
                    originalName: originalEventName,
                    detailLines,
                    tooltip: `${describeJourneyTone(tone)} ${originalEventName}${pagePath && pagePath !== '-' ? ` on ${pagePath}` : ''}`.trim(),
                    tone,
                };
            });
        }

        function buildPurchaseTimelineEvents(purchase = {}, options = {}) {
            const tone = resolveChannelTone(purchase.attributedChannel, purchase.attributedPlatform);
            const landingInfo = options.landingInfo || resolvePurchaseLandingInfo(purchase, options.events || []);
            const landing = landingInfo.landing;
            const sourceDescriptor = resolveAttributedSourceDescriptor(purchase);
            const campaign = sourceDescriptor.label;
            const sourceTypeLabel = humanReadableAttributionLabelType(sourceDescriptor.type);
            const clickId = purchase.attributedClickId || '-';
            const purchasedAt = formatRecentPurchaseDate(purchase);

            const entries = [
                {
                    icon: resolveChannelIcon(purchase.attributedChannel, purchase.attributedPlatform),
                    title: 'Ad Click',
                    originalName: 'Ad Click',
                    time: purchasedAt,
                    fullTime: purchasedAt,
                    detailLines: [
                        `Attributed ${sourceTypeLabel}: ${campaign}`,
                        `Click ID: ${clickId}`,
                    ],
                    tooltip: `Primary attribution touchpoint. ${humanReadableChannel(purchase.attributedChannel || 'unattributed', purchase.attributedPlatform || '')} ${campaign && campaign !== 'No campaign' ? `${sourceTypeLabel} ${campaign}` : 'source'}${clickId && clickId !== '-' ? ` with click id ${shortenJourneyIdentifier(clickId)}` : ''}.`,
                    tone,
                },
            ];

            if (landing && landing !== '-') {
                entries.push({
                    icon: 'fa-solid fa-door-open',
                    title: 'Landing',
                    originalName: 'Landing',
                    time: purchasedAt,
                    fullTime: purchasedAt,
                    detailLines: [`Page: ${landing}`],
                    tooltip: `First landing page captured for this stitched journey from ${landingInfo.chosenSource || 'the stitched events'}.`,
                    tone,
                });
            }

            entries.push({
                icon: 'fa-solid fa-circle-check',
                title: 'Purchase',
                originalName: 'Purchase',
                time: purchasedAt,
                fullTime: purchasedAt,
                detailLines: [
                    `Order: ${purchase.orderNumber || purchase.orderId || '-'}`,
                    `Revenue: ${formatCurrencyWithCode(Number(purchase.revenue || 0), purchase.currency || 'MXN')}`,
                ],
                tooltip: 'Final conversion event used as the anchor for backward stitching.',
                tone: 'is-organic',
            });

            return entries;
        }

        function getJourneyEventPayload(event = {}) {
            if (event?.rawPayload && typeof event.rawPayload === 'object') return event.rawPayload;
            if (event?.payload && typeof event.payload === 'object') return event.payload;
            return {};
        }

        function formatJourneySpan(seconds) {
            const value = Number(seconds || 0);
            if (!Number.isFinite(value) || value <= 0) return '<1m';
            if (value >= 86400) return `${Math.round(value / 86400)}d`;
            if (value >= 3600) return `${Math.round(value / 3600)}h`;
            return formatDurationCompact(value);
        }

        function describeJourneyTone(tone = '') {
            if (tone === 'is-google') return 'Google touchpoint inferred for this event.';
            if (tone === 'is-meta') return 'Meta touchpoint inferred for this event.';
            if (tone === 'is-tiktok') return 'TikTok touchpoint inferred for this event.';
            if (tone === 'is-organic') return 'Organic, direct, or referral touchpoint inferred for this event.';
            return 'No clear channel was detected for this event yet.';
        }

        function shortenJourneyIdentifier(value = '') {
            const raw = String(value || '').trim();
            if (!raw) return '';
            if (raw.length <= 10) return raw;
            return `${raw.slice(0, 4)}...${raw.slice(-4)}`;
        }

        function resolvePurchaseLandingInfo(purchase = {}, events = []) {
            const safeEvents = Array.isArray(events) ? events : [];
            const firstEventWithPage = safeEvents.find((event) => {
                const payload = getJourneyEventPayload(event);
                return event?.pageUrl || event?.url || payload?.pageUrl || payload?.page_url || payload?.url;
            }) || null;

            const candidates = [
                { label: 'purchase.landingPageUrl', value: purchase.landingPageUrl || '' },
                { label: 'attributionDebug.payloadPageUrl', value: purchase.attributionDebug?.payloadPageUrl || '' },
                { label: 'purchase.pageUrl', value: purchase.pageUrl || '' },
                { label: 'first stitched event pageUrl', value: firstEventWithPage?.pageUrl || firstEventWithPage?.url || '' },
                { label: 'first stitched payload pageUrl', value: (() => {
                    const payload = getJourneyEventPayload(firstEventWithPage || {});
                    return payload.pageUrl || payload.page_url || payload.url || '';
                })() },
            ];

            const chosenCandidate = candidates.find((candidate) => String(candidate.value || '').trim()) || null;
            const landing = chosenCandidate ? normalizeJourneyPath(chosenCandidate.value) : '-';
            const landingDisplay = landing && landing !== '-' ? landing : 'No landing captured';
            const orderRef = purchase.orderNumber || purchase.orderId || purchase.checkoutToken || 'unknown';

            console.info('[Journey Landing]', {
                orderRef,
                chosenSource: chosenCandidate?.label || 'none',
                landing: landingDisplay,
                candidates: candidates.map((candidate) => ({
                    source: candidate.label,
                    value: candidate.value || null,
                    normalizedPath: candidate.value ? normalizeJourneyPath(candidate.value) : null,
                })),
            });

            return {
                landing,
                landingDisplay,
                chosenSource: chosenCandidate?.label || '',
            };
        }

        function resolveJourneyReferrerLabel(referrer = '') {
            const value = String(referrer || '').trim();
            if (!value) return '';
            try {
                return new URL(value).hostname.replace(/^www\./i, '');
            } catch (_) {
                return value;
            }
        }

        function resolveJourneyTouchpoint({ payload = {}, purchase = {} } = {}) {
            const utmSource = String(payload.utm_source || payload.utmSource || '').trim().toLowerCase();
            const utmMedium = String(payload.utm_medium || payload.utmMedium || '').trim().toLowerCase();
            const utmCampaign = String(payload.utm_campaign || payload.utmCampaign || '').trim();
            const referrer = String(payload.referrer || payload.referer || '').trim();
            const referrerLabel = resolveJourneyReferrerLabel(referrer);
            const gclid = String(payload.gclid || '').trim();
            const fbclid = String(payload.fbclid || payload.fbc || payload._fbc || '').trim();
            const ttclid = String(payload.ttclid || '').trim();
            const fallbackChannel = normalizeAttributionChannel(purchase.attributedChannel || '', purchase.attributedPlatform || '');
            const fallbackSource = resolveAttributedSourceDescriptor(purchase);
            const fallbackCampaign = String(fallbackSource.label || '').trim();
            const fallbackClickId = String(purchase.attributedClickId || '').trim();

            let channelKey = 'organic';
            let label = 'Direct';
            let reason = 'No explicit campaign or click id was found in this session.';
            let clickId = '';

            if (fbclid) {
                channelKey = 'meta';
                label = 'Meta Ads';
                reason = 'Matched by Meta click id.';
                clickId = fbclid;
            } else if (ttclid) {
                channelKey = 'tiktok';
                label = 'TikTok Ads';
                reason = 'Matched by TikTok click id.';
                clickId = ttclid;
            } else if (gclid || (utmSource.includes('google') && /(cpc|paid|search|ads)/.test(utmMedium))) {
                channelKey = 'google';
                label = 'Google Ads';
                reason = gclid ? 'Matched by Google click id.' : 'Paid Google UTM detected.';
                clickId = gclid;
            } else if (utmSource.includes('meta') || utmSource.includes('facebook') || utmSource.includes('instagram')) {
                channelKey = 'meta';
                label = /(organic|social)/.test(utmMedium) ? 'Meta Organic' : 'Meta Ads';
                reason = 'Detected from Meta UTM source.';
            } else if (utmSource.includes('tiktok')) {
                channelKey = 'tiktok';
                label = /(organic|social)/.test(utmMedium) ? 'TikTok Organic' : 'TikTok Ads';
                reason = 'Detected from TikTok UTM source.';
            } else if (utmSource.includes('google')) {
                channelKey = /(cpc|paid|search|ads)/.test(utmMedium) ? 'google' : 'organic';
                label = channelKey === 'google' ? 'Google Ads' : 'Google Organic';
                reason = 'Detected from Google UTM source.';
            } else if (referrerLabel.includes('google')) {
                channelKey = 'organic';
                label = 'Google Organic';
                reason = `Referrer ${referrerLabel} indicates search traffic.`;
            } else if (referrerLabel.includes('facebook') || referrerLabel.includes('instagram')) {
                channelKey = 'organic';
                label = 'Meta Organic';
                reason = `Referrer ${referrerLabel} indicates social traffic.`;
            } else if (referrerLabel.includes('tiktok')) {
                channelKey = 'organic';
                label = 'TikTok Organic';
                reason = `Referrer ${referrerLabel} indicates social traffic.`;
            } else if (utmSource) {
                channelKey = normalizeAttributionChannel(utmSource);
                label = humanReadableChannel(utmSource, referrerLabel || utmSource);
                reason = `UTM source ${utmSource} was captured in this session.`;
            } else if (referrerLabel) {
                channelKey = 'organic';
                label = 'Referral';
                reason = `Referrer ${referrerLabel} stitched this session.`;
            } else if (fallbackChannel && fallbackChannel !== 'other') {
                channelKey = fallbackChannel;
                label = `${humanReadableChannel(purchase.attributedChannel || fallbackChannel, purchase.attributedPlatform || '')} inferred`;
                reason = 'Inherited from the final attributed purchase when this session had no explicit source.';
                clickId = fallbackClickId;
            }

            const campaign = utmCampaign || fallbackCampaign || '';
            const campaignSourceType = utmCampaign
                ? 'campaign'
                : (fallbackSource.type || 'campaign');
            const tone = resolveChannelTone(channelKey, label) || '';
            const icon = resolveChannelIcon(channelKey, label);
            const subLabel = campaign
                ? `Attributed ${humanReadableAttributionLabelType(campaignSourceType)}: ${campaign}`
                : clickId
                    ? `Click ID: ${shortenJourneyIdentifier(clickId)}`
                    : referrerLabel
                        ? `Referrer: ${referrerLabel}`
                        : 'No campaign metadata';

            return {
                channelKey,
                label,
                reason,
                campaign,
                clickId,
                referrerLabel,
                utmSource,
                utmMedium,
                sourceType: campaignSourceType,
                tone,
                icon,
                subLabel,
            };
        }

        function buildJourneySessionAttributionSentence(group = {}, options = {}) {
            const touchpoint = group.touchpoint || {};
            const sessionLabel = String(options.sessionLabel || group.label || 'This session').trim();
            const entryPage = group.entryPage && group.entryPage !== '-' ? group.entryPage : '';
            const campaign = String(touchpoint.campaign || '').trim();
            const sourceTypeLabel = humanReadableAttributionLabelType(touchpoint.sourceType || 'campaign');
            const clickId = String(touchpoint.clickId || '').trim();
            const referrerLabel = String(touchpoint.referrerLabel || '').trim();
            const channelLabel = String(touchpoint.label || 'Direct').trim();
            const actionCopy = String(group.actionCopy || '').trim();
            const lowerLabel = channelLabel.toLowerCase();

            let intro = `${sessionLabel} opened directly because no new ad click or campaign was captured before the return`;
            if (clickId && campaign) {
                intro = `${sessionLabel} opened after a ${channelLabel} click from ${sourceTypeLabel} ${campaign} (${shortenJourneyIdentifier(clickId)})`;
            } else if (clickId) {
                intro = `${sessionLabel} opened after a ${channelLabel} click (${shortenJourneyIdentifier(clickId)})`;
            } else if (campaign) {
                intro = `${sessionLabel} opened through ${channelLabel} ${sourceTypeLabel} ${campaign}`;
            } else if (referrerLabel) {
                intro = `${sessionLabel} opened from ${channelLabel} traffic coming from ${referrerLabel}`;
            } else if (lowerLabel.includes('direct')) {
                intro = `${sessionLabel} opened directly because no new ad click or campaign was captured before the return`;
            } else if (lowerLabel.includes('referral')) {
                intro = `${sessionLabel} opened from a referral source`;
            } else if (lowerLabel.includes('organic')) {
                intro = `${sessionLabel} opened through ${channelLabel} with no paid click id captured`;
            } else if (lowerLabel.includes('inferred')) {
                intro = `${sessionLabel} was inferred from the final purchase attribution when this session had no fresh source metadata`;
            } else {
                intro = `${sessionLabel} opened through ${channelLabel}`;
            }

            const landingCopy = entryPage ? `, landing on ${entryPage}` : ', returning to the site';
            const actionSentence = actionCopy ? ` ${actionCopy}` : '';
            return `${intro}${landingCopy}.${actionSentence}`.trim();
        }

        function buildJourneyReturnConnectorSentence(nextGroup = {}) {
            if (!nextGroup || typeof nextGroup !== 'object') return 'The user returned and continued the stitched journey.';
            const sentence = buildJourneySessionAttributionSentence(nextGroup, {
                sessionLabel: nextGroup.label || 'The next session',
            });
            return sentence.replace(/^Session \d+\s+/i, 'The user ');
        }

        function summarizeJourneyGroupActions(events = []) {
            const ordered = Array.from(new Set(
                (Array.isArray(events) ? events : [])
                    .map((event) => normalizeEventNameHuman(event.eventName || event.name))
                    .filter(Boolean)
            ));
            return ordered.slice(0, 3);
        }

        function buildPurchaseSessionStory(purchase = {}) {
            const availableEvents = Array.isArray(purchase.events)
                ? purchase.events
                : (Array.isArray(purchase.stitchedEvents) ? purchase.stitchedEvents : []);
            const purchaseTimestamp = new Date(purchase.platformCreatedAt || purchase.createdAt || Date.now()).getTime();

            const rawEvents = availableEvents
                .map((event) => {
                    const payload = getJourneyEventPayload(event);
                    const eventTs = new Date(event.createdAt || event.collectedAt || purchase.platformCreatedAt || purchase.createdAt || 0).getTime();
                    const pageUrl = event.pageUrl || event.url || payload.pageUrl || payload.page_url || payload.url || '';
                    return {
                        ...event,
                        _ts: eventTs,
                        _payload: payload,
                        _pagePath: normalizeJourneyPath(pageUrl),
                    };
                })
                .filter((event) => Number.isFinite(event._ts))
                .sort((a, b) => a._ts - b._ts);

            const dedupedEvents = dedupeAdjacentIdenticalEvents(rawEvents);
            const groups = [];
            const fallbackUserKey = String(purchase.userKey || '').trim();
            const maxSessionGapMs = 30 * 60 * 1000;

            dedupedEvents.forEach((event) => {
                const sessionId = String(event.sessionId || '').trim();
                const userKey = String(event.userKey || fallbackUserKey || '').trim();
                const groupingKey = sessionId || (userKey ? `user:${userKey}` : 'anonymous');
                const previous = groups[groups.length - 1];
                const shouldStartNewGroup = !previous
                    || previous.groupingKey !== groupingKey
                    || (!sessionId && (event._ts - previous.lastTs) > maxSessionGapMs);

                if (shouldStartNewGroup) {
                    groups.push({
                        groupingKey,
                        sessionId,
                        userKey,
                        startedTs: event._ts,
                        endedTs: event._ts,
                        lastTs: event._ts,
                        events: [event],
                    });
                    return;
                }

                previous.events.push(event);
                previous.endedTs = event._ts;
                previous.lastTs = event._ts;
                if (!previous.sessionId && sessionId) previous.sessionId = sessionId;
                if (!previous.userKey && userKey) previous.userKey = userKey;
            });

            const normalizedGroups = groups.map((group, index) => {
                const firstEvent = group.events[0] || {};
                const lastEvent = group.events[group.events.length - 1] || {};
                const touchpointEvent = group.events.find((event) => {
                    const payload = event._payload || {};
                    return payload.fbclid || payload.fbc || payload._fbc || payload.gclid || payload.ttclid || payload.utm_source || payload.utmSource || payload.referrer || payload.referer;
                }) || firstEvent;
                const touchpoint = resolveJourneyTouchpoint({ payload: touchpointEvent._payload || {}, purchase });
                const eventNames = summarizeJourneyGroupActions(group.events);
                const entryPage = group.events.find((event) => event._pagePath && event._pagePath !== '-')?._pagePath || '-';
                const exitPage = [...group.events].reverse().find((event) => event._pagePath && event._pagePath !== '-')?._pagePath || entryPage;
                const eventCount = group.events.length;
                const durationSeconds = Math.max(0, (group.endedTs - group.startedTs) / 1000);
                const lastPurchaseEvent = [...group.events].reverse().find((event) => isPurchaseJourneyEventName(event.eventName || event.name || '')) || null;
                const containsPurchase = Boolean(lastPurchaseEvent);
                const containsCheckout = group.events.some((event) => String(event.eventName || event.name || '').toLowerCase() === 'begin_checkout');
                const containsCart = group.events.some((event) => String(event.eventName || event.name || '').toLowerCase() === 'add_to_cart');
                const containsLogin = group.events.some((event) => /login/.test(String(event.eventName || event.name || '').toLowerCase()));

                let actionCopy = 'Browsing and consideration.';
                if (containsPurchase) actionCopy = 'Purchase completed in this session.';
                else if (containsCheckout) actionCopy = 'Reached checkout in this session.';
                else if (containsCart) actionCopy = 'Added product(s) to cart.';
                else if (containsLogin) actionCopy = 'User identified with a login event.';

                const stitchedCopy = buildJourneySessionAttributionSentence({
                    label: `Session ${index + 1}`,
                    entryPage,
                    touchpoint,
                    actionCopy,
                });

                return {
                    label: `Session ${index + 1}`,
                    sessionId: group.sessionId,
                    userKey: group.userKey,
                    startedAt: new Date(group.startedTs).toISOString(),
                    endedAt: new Date(group.endedTs).toISOString(),
                    timeLabel: formatDateTimeMx(group.startedTs),
                    durationLabel: formatJourneySpan(durationSeconds),
                    eventCount,
                    entryPage,
                    exitPage,
                    eventNames,
                    containsPurchase,
                    purchaseAt: lastPurchaseEvent
                        ? new Date(lastPurchaseEvent._ts).toISOString()
                        : (index === groups.length - 1 && Number.isFinite(purchaseTimestamp) ? new Date(purchaseTimestamp).toISOString() : null),
                    isPurchaseAnchorSession: index === groups.length - 1,
                    touchpoint,
                    tone: touchpoint.tone || '',
                    icon: touchpoint.icon || 'fa-solid fa-route',
                    sessionIdShort: shortenJourneyIdentifier(group.sessionId),
                    userKeyShort: shortenJourneyIdentifier(group.userKey),
                    actionCopy,
                    stitchedCopy,
                };
            });

            const firstGroupTs = normalizedGroups[0]?.startedAt ? new Date(normalizedGroups[0].startedAt).getTime() : purchaseTimestamp;
            const totalSpanSeconds = Math.max(0, (purchaseTimestamp - firstGroupTs) / 1000);
            const channelTrail = normalizedGroups
                .map((group) => group.touchpoint?.label || '')
                .filter(Boolean)
                .slice(0, 4);

            return {
                hasRealEvents: normalizedGroups.length > 0,
                groups: normalizedGroups,
                totalSessions: normalizedGroups.length || ((purchase.sessionId || purchase.orderId || purchase.checkoutToken) ? 1 : 0),
                totalEvents: dedupedEvents.length,
                totalSpanLabel: formatJourneySpan(totalSpanSeconds),
                channelTrail,
            };
        }

        function formatJourneySessionGapLabel(seconds = 0) {
            const value = Math.max(0, Number(seconds || 0));
            if (!Number.isFinite(value) || value <= 0) return 'Returns moments later';
            if (value >= 86400) {
                const days = Math.max(1, Math.round(value / 86400));
                return `Returns ${days} day${days === 1 ? '' : 's'} later`;
            }
            if (value >= 3600) {
                const hours = Math.max(1, Math.round(value / 3600));
                return `Returns ${hours} hour${hours === 1 ? '' : 's'} later`;
            }
            if (value >= 60) {
                const minutes = Math.max(1, Math.round(value / 60));
                return `Returns ${minutes} minute${minutes === 1 ? '' : 's'} later`;
            }
            const secs = Math.max(1, Math.round(value));
            return `Returns ${secs} second${secs === 1 ? '' : 's'} later`;
        }

        function buildPurchaseSessionTimelineEvents(events = [], story = {}, options = {}) {
            const baseEvents = Array.isArray(events) ? events.map((event) => ({ ...event })) : [];
            const groups = Array.isArray(story.groups) ? story.groups : [];
            if (!baseEvents.length || !groups.length) return baseEvents;

            const timeline = [];

            groups.forEach((group, index) => {
                const sessionLabel = group.label || `Session ${index + 1}`;
                const sessionEvents = baseEvents
                    .filter((event) => Number(event.sessionGroupIndex ?? event._sessionGroupIndex) === index)
                    .map((event) => ({
                        ...event,
                        sessionLabel,
                    }));
                const attributionSentence = buildJourneySessionAttributionSentence(group);
                const purchaseTs = group.purchaseAt ? new Date(group.purchaseAt).getTime() : NaN;
                const mainSessionEvents = [];
                const postPurchaseEvents = [];

                sessionEvents.forEach((event) => {
                    const eventTs = Number(event.rawTs || 0);
                    if (Number.isFinite(purchaseTs) && purchaseTs > 0 && Number.isFinite(eventTs) && eventTs > purchaseTs && !isPurchaseJourneyEventName(event.rawEventName || '')) {
                        postPurchaseEvents.push(event);
                    } else {
                        mainSessionEvents.push(event);
                    }
                });

                const hasVisiblePurchase = [...mainSessionEvents, ...postPurchaseEvents].some((event) =>
                    isPurchaseJourneyEventName(event.rawEventName || '')
                );

                if ((group.containsPurchase || group.isPurchaseAnchorSession) && !hasVisiblePurchase) {
                    mainSessionEvents.push({
                        type: 'synthetic_purchase',
                        kindClass: 'synthetic-purchase',
                        sessionLabel,
                        icon: 'fa-solid fa-bag-shopping',
                        title: 'Purchase',
                        originalName: 'Purchase',
                        time: formatDateTimeMx(group.purchaseAt || group.endedAt || group.startedAt || null),
                        fullTime: formatDateTimeMx(group.purchaseAt || group.endedAt || group.startedAt || null),
                        rawEventName: 'purchase',
                        rawTs: Number.isFinite(purchaseTs) && purchaseTs > 0 ? purchaseTs : new Date(group.endedAt || group.startedAt || 0).getTime(),
                        detailLines: ['Purchase anchor confirmed for this session, even if the raw browser event was condensed or not available in the visible timeline.'],
                        tone: 'is-organic',
                    });
                }

                timeline.push({
                    type: 'session_marker',
                    kindClass: 'session-marker',
                    label: sessionLabel,
                    title: sessionLabel,
                    originalName: sessionLabel,
                    time: group.timeLabel || '-',
                    fullTime: group.timeLabel || '-',
                    tone: group.tone || '',
                    icon: group.icon || 'fa-solid fa-route',
                    detailLines: [attributionSentence],
                    copy: attributionSentence,
                });
                timeline.push(...mainSessionEvents);

                if (postPurchaseEvents.length) {
                    const firstPostPurchaseEvent = postPurchaseEvents[0] || {};
                    timeline.push({
                        type: 'post_purchase_marker',
                        kindClass: 'session-gap post-purchase-marker',
                        label: 'Post-purchase confirmation',
                        title: 'Post-purchase confirmation',
                        originalName: 'Post-purchase confirmation',
                        time: firstPostPurchaseEvent.fullTime || firstPostPurchaseEvent.time || group.timeLabel || '-',
                        fullTime: firstPostPurchaseEvent.fullTime || firstPostPurchaseEvent.time || group.timeLabel || '-',
                        icon: 'fa-solid fa-receipt',
                        detailLines: [
                            `${postPurchaseEvents.length} confirmation event${postPurchaseEvents.length === 1 ? '' : 's'} captured after the purchase, usually thank-you page activity, order confirmation loads, or browser follow-up signals.`,
                        ],
                    });
                    timeline.push(...postPurchaseEvents);
                }

                const nextGroup = groups[index + 1] || null;
                if (nextGroup) {
                    const gapSeconds = Math.max(0, (new Date(nextGroup.startedAt).getTime() - new Date(group.endedAt).getTime()) / 1000);
                    timeline.push({
                        type: 'session_gap',
                        kindClass: 'session-gap',
                        label: formatJourneySessionGapLabel(gapSeconds),
                        title: formatJourneySessionGapLabel(gapSeconds),
                        originalName: 'Session Gap',
                        time: nextGroup.timeLabel || '-',
                        fullTime: nextGroup.timeLabel || '-',
                        icon: 'fa-solid fa-arrow-down',
                        detailLines: [buildJourneyReturnConnectorSentence(nextGroup)],
                    });
                }
            });

            return timeline;
        }

        function renderJourneySessionStory(story = {}, purchase = {}) {
            const groups = Array.isArray(story.groups) ? story.groups : [];
            const orderLabel = purchase.orderNumber || purchase.orderId || purchase.checkoutToken || '-';
            const purchaseTime = formatRecentPurchaseDate(purchase);
            const revenue = formatCurrencyWithCode(Number(purchase.revenue || 0), purchase.currency || 'MXN');
            const stitchedSummary = groups.length > 1
                ? `Stitched backward from purchase #${orderLabel} across ${groups.length} sessions and ${Number(story.totalEvents || 0)} stitched events.`
                : `Stitched backward from purchase #${orderLabel} using the strongest session and identity signals available.`;

            if (!groups.length) {
                return `
                    <div class="journey-session-story">
                        <div class="journey-session-summary">
                            <p class="journey-session-summary-title">Conversion Story</p>
                            <p class="journey-session-summary-copy">${escapeHtml(stitchedSummary)}</p>
                            <div class="journey-meta-grid mt-3">
                                <span class="journey-chip" data-tooltip="Revenue from the anchor purchase."><i class="fa-solid fa-sack-dollar"></i>${escapeHtml(revenue)}</span>
                                <span class="journey-chip" data-tooltip="Time when the anchor purchase was recorded."><i class="fa-solid fa-clock"></i>${escapeHtml(purchaseTime)}</span>
                            </div>
                        </div>
                    </div>
                `;
            }

            return `
                <div class="journey-session-story">
                    <div class="journey-session-summary">
                        <p class="journey-session-summary-title">Conversion Story</p>
                        <p class="journey-session-summary-copy">${escapeHtml(stitchedSummary)}</p>
                        <div class="journey-meta-grid mt-3">
                            <span class="journey-chip" data-tooltip="How many stitched sessions were linked to this conversion."><i class="fa-solid fa-layer-group"></i>${Number(story.totalSessions || 0)} sessions</span>
                            <span class="journey-chip" data-tooltip="How many stitched events support the journey reconstruction."><i class="fa-solid fa-bolt"></i>${Number(story.totalEvents || 0)} events</span>
                            <span class="journey-chip" data-tooltip="Elapsed time from the first stitched session to the purchase anchor."><i class="fa-solid fa-clock-rotate-left"></i>${escapeHtml(story.totalSpanLabel || '<1m')}</span>
                            <span class="journey-chip" data-tooltip="Revenue from the final purchase anchor."><i class="fa-solid fa-sack-dollar"></i>${escapeHtml(revenue)}</span>
                        </div>
                    </div>
                    <div class="journey-session-stack">
                        ${groups.map((group, index) => {
                            const nextGroup = groups[index + 1] || null;
                            const gapLabel = nextGroup
                                ? `returns ${formatJourneySpan(Math.max(0, (new Date(nextGroup.startedAt).getTime() - new Date(group.endedAt).getTime()) / 1000))} later`
                                : 'purchase anchor';
                            return `
                                <article class="journey-session-card ${group.tone || ''}">
                                    <div class="journey-session-card-head">
                                        <span class="journey-session-label">${escapeHtml(group.label)}</span>
                                        <span class="journey-session-time">${escapeHtml(group.timeLabel || '-')}</span>
                                    </div>
                                    <div class="journey-session-touchpoint ${group.tone || ''}" title="${escapeHtmlAttr(group.touchpoint?.reason || 'No source metadata')}" data-tooltip="${escapeHtmlAttr(group.touchpoint?.reason || 'No source metadata')}">
                                        <span class="journey-session-touchpoint-title"><i class="${group.icon || 'fa-solid fa-route'}"></i>${escapeHtml(group.touchpoint?.label || 'Session touchpoint')}</span>
                                        <span class="journey-session-touchpoint-sub">${escapeHtml(group.touchpoint?.subLabel || group.touchpoint?.reason || 'No source metadata')}</span>
                                    </div>
                                    <div class="journey-session-kpis">
                                        <span class="journey-chip" data-tooltip="How many events were stitched inside this session block."><i class="fa-solid fa-wave-square"></i>${Number(group.eventCount || 0)} events</span>
                                        <span class="journey-chip" data-tooltip="First page captured for this stitched session."><i class="fa-solid fa-door-open"></i>${escapeHtml(group.entryPage || '-')}</span>
                                        <span class="journey-chip" data-tooltip="Observed duration of this stitched session block."><i class="fa-solid fa-timer"></i>${escapeHtml(group.durationLabel || '<1m')}</span>
                                        ${group.sessionIdShort ? `<span class="journey-chip" data-tooltip="Session identifier shortened for readability."><i class="fa-solid fa-fingerprint"></i>${escapeHtml(group.sessionIdShort)}</span>` : ''}
                                    </div>
                                    <p class="journey-session-copy">${escapeHtml(group.stitchedCopy || '')}</p>
                                    ${group.eventNames.length ? `<div class="journey-session-kpis">${group.eventNames.map((name) => `<span class="journey-chip" data-tooltip="Detected event inside this session block."><i class="fa-solid fa-check"></i>${escapeHtml(name)}</span>`).join('')}</div>` : ''}
                                </article>
                                <div class="journey-session-arrow">
                                    <i class="fa-solid fa-arrow-down"></i>
                                    <span>${escapeHtml(gapLabel)}</span>
                                </div>
                            `;
                        }).join('')}
                        <article class="journey-session-card journey-session-anchor">
                            <div class="journey-session-card-head">
                                <span class="journey-session-label">Purchase Anchor</span>
                                <span class="journey-session-time">${escapeHtml(purchaseTime)}</span>
                            </div>
                            <div class="journey-session-touchpoint is-organic" title="Final conversion event used to anchor attribution and stitch backward." data-tooltip="Final conversion event used to anchor attribution and stitch backward.">
                                <span class="journey-session-touchpoint-title"><i class="fa-solid fa-bag-shopping"></i>Order #${escapeHtml(orderLabel)}</span>
                                <span class="journey-session-touchpoint-sub">${escapeHtml(revenue)} · ${escapeHtml(humanReadableChannel(purchase.attributedChannel || 'unattributed', purchase.attributedPlatform || ''))}</span>
                            </div>
                            <div class="journey-session-kpis">
                                <span class="journey-chip" data-tooltip="Campaign attributed to the final purchase."><i class="fa-solid fa-bullhorn"></i>${escapeHtml(resolveAttributedCampaignLabel(purchase))}</span>
                                ${purchase.attributedClickId ? `<span class="journey-chip" data-tooltip="Click identifier linked to the final attributed touchpoint."><i class="fa-solid fa-link"></i>${escapeHtml(shortenJourneyIdentifier(purchase.attributedClickId))}</span>` : ''}
                            </div>
                            <p class="journey-session-copy">This is the final conversion event. Attribution is resolved here, then the stitch walks backward through the sessions above.</p>
                        </article>
                    </div>
                </div>
            `;
        }

        function countPurchaseJourneySessions(purchase = {}) {
            const story = buildPurchaseSessionStory(purchase);
            return Number(story.totalSessions || 0);
        }

        function buildPurchaseTrackedUtmHistory(purchase = {}) {
            const events = Array.isArray(purchase.events) ? purchase.events : (Array.isArray(purchase.stitchedEvents) ? purchase.stitchedEvents : []);
            const sessionMap = new Map();
            const anchorSessionId = String(purchase.sessionId || '').trim();

            const ensureSession = (sessionId, fallback = {}) => {
                const safeSessionId = String(sessionId || '').trim();
                if (!safeSessionId) return null;

                if (!sessionMap.has(safeSessionId)) {
                    sessionMap.set(safeSessionId, {
                        sessionId: safeSessionId,
                        startedAt: fallback.startedAt || null,
                        lastEventAt: fallback.lastEventAt || null,
                        isCurrentSession: anchorSessionId ? safeSessionId === anchorSessionId : false,
                        urlsMap: new Map(),
                    });
                }

                const current = sessionMap.get(safeSessionId);
                if (fallback.startedAt && !current.startedAt) current.startedAt = fallback.startedAt;
                if (fallback.lastEventAt) current.lastEventAt = fallback.lastEventAt;
                return current;
            };

            const addEntry = (sessionId, entry, fallback = {}) => {
                const group = ensureSession(sessionId || fallback.sessionId, fallback);
                if (!group) return;

                const normalized = normalizeTrackedHistoryEntry(entry, {
                    sessionId: group.sessionId,
                    capturedAt: fallback.capturedAt || null,
                    url: fallback.url || null,
                    utmSource: fallback.utmSource || null,
                    utmMedium: fallback.utmMedium || null,
                    utmCampaign: fallback.utmCampaign || null,
                    utmContent: fallback.utmContent || null,
                    utmTerm: fallback.utmTerm || null,
                    ga4SessionSource: fallback.ga4SessionSource || null,
                    fbclid: fallback.fbclid || null,
                    gclid: fallback.gclid || null,
                    ttclid: fallback.ttclid || null,
                    clickId: fallback.clickId || null,
                });
                if (!normalized) return;

                const key = normalized.url;
                const previous = group.urlsMap.get(key);
                if (!previous) {
                    group.urlsMap.set(key, normalized);
                    return;
                }

                const prevTs = new Date(previous.capturedAt || 0).getTime();
                const nextTs = new Date(normalized.capturedAt || 0).getTime();
                if (nextTs && (!prevTs || nextTs < prevTs)) {
                    group.urlsMap.set(key, normalized);
                }
            };

            events.forEach((event) => {
                const sessionId = String(event.sessionId || '').trim();
                const fallback = {
                    sessionId,
                    startedAt: event.createdAt || event.collectedAt || null,
                    lastEventAt: event.createdAt || event.collectedAt || null,
                    capturedAt: event.createdAt || event.collectedAt || null,
                    url: event.pageUrl || null,
                    utmSource: event.utmSource || null,
                    utmMedium: event.utmMedium || null,
                    utmCampaign: event.utmCampaign || null,
                    utmContent: event.utmContent || null,
                    utmTerm: event.utmTerm || null,
                    ga4SessionSource: event.ga4SessionSource || null,
                    fbclid: event.fbclid || null,
                    gclid: event.gclid || null,
                    ttclid: event.ttclid || null,
                    clickId: event.clickId || null,
                };

                addEntry(sessionId, { url: event.utmEntryUrl || null }, fallback);
                addEntry(sessionId, { url: event.pageUrl || null }, fallback);

                parseTrackedHistoryArray(event.utmSessionHistory).forEach((entry) => addEntry(sessionId, entry, fallback));
                parseTrackedHistoryArray(event.utmBrowserHistory).forEach((entry) => addEntry(sessionId, entry, fallback));
            });

            const sessions = Array.from(sessionMap.values())
                .map((group) => {
                    const urls = Array.from(group.urlsMap.values())
                        .sort((a, b) => new Date(a.capturedAt || 0).getTime() - new Date(b.capturedAt || 0).getTime());

                    return {
                        sessionId: group.sessionId,
                        startedAt: group.startedAt || null,
                        lastEventAt: group.lastEventAt || null,
                        isCurrentSession: group.isCurrentSession,
                        touchCount: urls.length,
                        urls,
                    };
                })
                .filter((group) => group.touchCount > 0)
                .sort((a, b) => {
                    if (a.isCurrentSession !== b.isCurrentSession) return a.isCurrentSession ? -1 : 1;
                    return new Date(b.startedAt || b.lastEventAt || 0).getTime() - new Date(a.startedAt || a.lastEventAt || 0).getTime();
                });

            return {
                totalUrls: sessions.reduce((sum, session) => sum + Number(session.touchCount || 0), 0),
                sessionCount: sessions.length,
                sessions,
            };
        }

        function renderFocusedPurchaseJourneyCard(purchase = {}, displayName = '') {
            const journeyData = buildMinimalJourneyNodesFromPurchase(purchase, selectedJourneyTimelineMode);
            const sessionCount = Number(journeyData.sessionStory?.totalSessions || countPurchaseJourneySessions(purchase) || 0);
            const purchaseUtmHistory = buildPurchaseTrackedUtmHistory(purchase);
            return `
                <div class="journey-compact-card space-y-4">
                    <div class="flex items-center justify-between gap-2 flex-wrap">
                        <span class="text-xs text-gray-500">${formatRecentPurchaseDate(purchase)}</span>
                        <span class="journey-chip" data-tooltip="Resolved user or customer label for this stitched purchase journey."><i class="fa-solid fa-user"></i>${escapeHtml(journeyData.summary?.userName || displayName || 'Customer')}</span>
                    </div>
                    <div class="journey-meta-grid">
                        <span class="journey-chip" data-tooltip="Confidence level of the stitched attribution for this purchase."><i class="fa-solid fa-percent"></i>${Number(journeyData.summary?.confidence || 0)}%</span>
                        <span class="journey-chip" data-tooltip="Attributed campaign or the best campaign label recovered so far."><i class="fa-solid fa-bullhorn"></i>${escapeHtml(journeyData.summary?.sourceAd || 'No campaign')}</span>
                        <span class="journey-chip" data-tooltip="Initial landing page captured for this stitched journey."><i class="fa-solid fa-door-open"></i>${escapeHtml(journeyData.summary?.landing || 'No landing captured')}</span>
                        <span class="journey-chip" data-tooltip="How many stitched sessions currently support this purchase path."><i class="fa-solid fa-layer-group"></i>${sessionCount} sessions</span>
                    </div>
                    <div>
                        <p class="font-medium text-gray-900 mb-1">UTM URL history for this journey</p>
                        ${renderTrackedUtmHistory(purchaseUtmHistory, { emptyMessage: 'No UTM URLs have been captured yet for this selected journey.' })}
                    </div>
                    ${renderTimelineModeToggle(selectedJourneyTimelineMode)}
                    ${renderJourneyVerticalTimeline(journeyData.timelineEvents)}
                </div>
            `;
        }

        function renderJourneyVerticalTimeline(events = []) {
            if (!events.length) {
                return '<p class="text-sm text-gray-500">Not enough journey events yet.</p>';
            }

            const actualEventCount = events.filter((event) =>
                event.type !== 'session_marker'
                && event.type !== 'session_gap'
                && event.type !== 'post_purchase_marker'
            ).length;

            return `
                <div class="journey-timeline">
                    <div class="journey-timeline-sticky"><i class="fa-solid fa-arrows-up-down"></i>${actualEventCount} events</div>
                    ${events.map((event) => `
                        <article class="journey-event ${event.kindClass || ''} ${event.tone || ''}">
                            <div class="journey-event-head">
                                <span class="journey-event-title"><span class="journey-event-icon"><i class="${event.icon || 'fa-solid fa-circle'}"></i></span>${event.title || 'Event'}</span>
                                ${event.sessionLabel ? `<span class="journey-event-session-chip"><i class="fa-solid fa-layer-group"></i>${escapeHtml(event.sessionLabel)}</span>` : ''}
                            </div>
                            <div class="journey-event-detail">
                                ${event.originalName ? `<p class="font-semibold text-gray-700 mb-1">${escapeHtml(event.originalName)} - ${escapeHtml(event.fullTime || event.time)}</p>` : (event.time ? `<p class="font-semibold text-gray-700 mb-1">${escapeHtml(event.fullTime || event.time)}</p>` : '')}
                                ${(Array.isArray(event.detailLines) ? event.detailLines : []).slice(0, 3).map((line) => `<p>${escapeHtml(line)}</p>`).join('')}
                            </div>
                        </article>
                    `).join('')}
                </div>
            `;
        }

        function renderTimelineModeToggle(mode = 'condensed') {
            return `
                <div class="journey-mode-toggle" id="journey-mode-toggle">
                    <button type="button" class="journey-mode-btn ${mode === 'condensed' ? 'is-active' : ''}" data-journey-mode="condensed">Condensed</button>
                    <button type="button" class="journey-mode-btn ${mode === 'full' ? 'is-active' : ''}" data-journey-mode="full">Full</button>
                </div>
            `;
        }

        function wireTimelineModeToggle(container) {
            if (!container) return;
            container.querySelectorAll('[data-journey-mode]').forEach((button) => {
                button.addEventListener('click', () => {
                    const mode = String(button.getAttribute('data-journey-mode') || 'condensed').toLowerCase();
                    if (mode !== 'condensed' && mode !== 'full') return;
                    selectedJourneyTimelineMode = mode;
                    renderAttributionJourneyPanel();
                });
            });
        }

        function buildMinimalJourneyNodesFromSessionData(sessionData = {}, timelineMode = 'condensed') {
            const journey = sessionData.journey || {};
            const session = sessionData.session || {};
            const metrics = sessionData.metrics || {};
            const events = Array.isArray(sessionData.events) ? sessionData.events : (Array.isArray(sessionData.timeline) ? sessionData.timeline : []);
            const orders = Array.isArray(sessionData.orders) ? sessionData.orders : [];
            const channel = journey.attribution?.channel || session.utmSource || 'organic';
            const platform = journey.attribution?.platform || null;
            const confidence = Math.round(Number(journey.attribution?.confidence || 0) * 100);
            const leads = deriveJourneySignalsFromEvents(events).lead;
            const userName = humanReadablePersonName(sessionData?.identifiedUser?.customerDisplayName || sessionData?.identifiedUser?.emailPreview || '', 'Customer');
            const landing = normalizeJourneyPath(session.landingPageUrl || journey.entryPage || '');
            const sourceAd = journey.attribution?.campaign || session.utmCampaign || 'No campaign';
            const timelineEvents = buildSessionTimelineEvents(sessionData, { mode: timelineMode });

            return {
                summary: {
                    leads,
                    confidence,
                    userName,
                    source: humanReadableChannel(channel, platform),
                    sourceAd,
                    landing,
                },
                steps: [],
                timelineEvents,
                purchaseBubble: metrics.purchase > 0 || orders.length > 0 ? `${orders.length || metrics.purchase} purchase(s)` : 'no purchase',
                adTone: resolveChannelTone(channel, platform),
            };
        }

        function buildMinimalJourneyNodesFromPurchase(purchase = {}, timelineMode = 'condensed') {
            const confidence = Math.round(Number(purchase.attributionConfidence || 0) * 100);
            const hasPurchase = Number(purchase.revenue || 0) > 0;
            const userName = humanReadablePersonName(resolvePurchaseCustomerName(purchase) || '', 'Customer');
            const source = humanReadableChannel(purchase.attributedChannel, purchase.attributedPlatform || '');
            const sourceAd = resolveAttributedCampaignLabel(purchase);
            const availableEvents = Array.isArray(purchase.events) ? purchase.events : (Array.isArray(purchase.stitchedEvents) ? purchase.stitchedEvents : []);
            const landingInfo = resolvePurchaseLandingInfo(purchase, availableEvents);
            const landing = landingInfo.landingDisplay;
            const sessionStory = buildPurchaseSessionStory(purchase);
            
            // If purchase includes real events, build timeline from those events
            let timelineEvents = buildPurchaseTimelineEvents(purchase, { landingInfo, events: availableEvents });
            if (Array.isArray(availableEvents) && availableEvents.length > 0) {
                let realEvents = availableEvents
                    .map((event) => ({
                        ...event,
                        _ts: new Date(event.createdAt || event.collectedAt || 0).getTime(),
                    }))
                    .filter((event) => Number.isFinite(event._ts))
                    .sort((a, b) => a._ts - b._ts);
                    
                realEvents = dedupeAdjacentIdenticalEvents(realEvents);

                if (realEvents.length > 0) {
                    let groupCursor = 0;
                    (Array.isArray(sessionStory.groups) ? sessionStory.groups : []).forEach((group, groupIndex) => {
                        const takeCount = Math.max(0, Number(group.eventCount || 0));
                        for (let offset = 0; offset < takeCount; offset += 1) {
                            if (realEvents[groupCursor + offset]) {
                                realEvents[groupCursor + offset]._sessionGroupIndex = groupIndex;
                            }
                        }
                        groupCursor += takeCount;
                    });

                    const sourceEvents = timelineMode === 'full'
                        ? realEvents
                        : condenseSessionEvents(realEvents).events;

                    timelineEvents = sourceEvents.map((event, index) => {
                        if (event.eventName === '__condensed__') {
                            return {
                                icon: 'fa-solid fa-filter',
                                tooltip: 'Low-signal events were condensed in this view. Switch to Full to inspect everything.',
                                title: 'Condensed events',
                                time: '-',
                                fullTime: '-',
                                originalName: 'Condensed events',
                                rawEventName: '__condensed__',
                                rawTs: Number(event._ts || 0),
                                detailLines: event._detailLines || [],
                                tone: '',
                                sessionGroupIndex: Number(event._sessionGroupIndex),
                            };
                        }

                        const next = sourceEvents[index + 1];
                        const durSeconds = next ? Math.max(0, (next._ts - event._ts) / 1000) : 0;
                        const pagePath = normalizeJourneyPath(event.pageUrl || event.url || '');
                        const itemName = event.productName || event.productId || event.itemId || '';
                        
                        const detailLines = [
                            pagePath && pagePath !== '-' ? `Page: ${pagePath}` : '',
                            itemName ? `Item: ${itemName}` : '',
                        ].filter(Boolean);

                        let baseTitle = normalizeEventNameHuman(event.eventName || event.name);
                        let originalEventName = baseTitle;
                        const rawName = String(event.eventName || event.name || '').toLowerCase();
                        if (rawName === 'page_view' && pagePath && pagePath !== '-') {
                            baseTitle = pagePath.replace(/^\/|\/$/g, '') || 'home';
                        }

                        const timeStr = formatDateTimeMx(event.createdAt || event.collectedAt || null);
                        let displayTime = timeStr;
                        if (index > 0) {
                            const prev = realEvents[index - 1];
                            const prevTimeStr = formatDateTimeMx(prev.createdAt || prev.collectedAt || null);
                            if (timeStr === prevTimeStr) {
                                displayTime = '...';
                            }
                        }

                        return {
                            icon: resolveEventIcon(event.eventName || event.name),
                            tooltip: `${describeJourneyTone(resolveChannelTone(event.utmSource || purchase.attributedChannel || '', purchase.attributedPlatform || null))} ${originalEventName || baseTitle}${pagePath && pagePath !== '-' ? ` on ${pagePath}` : ''}`.trim(),
                            title: durSeconds > 0 ? `${baseTitle} <span class="text-gray-400 text-[0.8rem]" style="margin-left: 0.5rem; font-weight: 500;">${formatDurationCompact(durSeconds)}</span>` : baseTitle,
                            time: displayTime,
                            fullTime: timeStr,
                            originalName: originalEventName,
                            rawEventName: rawName,
                            rawTs: Number(event._ts || 0),
                            detailLines,
                            tone: resolveChannelTone(event.utmSource || purchase.attributedChannel || '', purchase.attributedPlatform || null),
                            sessionGroupIndex: Number(event._sessionGroupIndex),
                        };
                    });

                    timelineEvents = buildPurchaseSessionTimelineEvents(timelineEvents, sessionStory, { mode: timelineMode });
                }
            }
            
            return {
                summary: {
                    leads: null,
                    confidence,
                    userName,
                    source,
                    sourceAd,
                    landing,
                },
                steps: [],
                timelineEvents,
                sessionStory,
                purchaseBubble: hasPurchase ? formatCurrencyWithCode(Number(purchase.revenue || 0), purchase.currency || 'MXN') : 'no revenue',
                adTone: resolveChannelTone(purchase.attributedChannel, purchase.attributedPlatform),
            };
        }

        function renderJourneyHeadlineBubbles(summary = {}, purchaseBubble = 'no purchase', adTone = '') {
            return `
                <div class="journey-rail-wrap">
                    <div class="journey-rail-line"></div>
                    <div class="journey-rail" style="grid-template-columns: repeat(2, minmax(0, 1fr));">
                        <div class="journey-node ${adTone || ''} is-active">
                            <span class="journey-node-title"><i class="fa-solid fa-bullseye"></i>Ad Click</span>
                            <span class="journey-node-sub">${escapeHtml(summary.source || '-')} · ${escapeHtml(String(summary.confidence ?? 0))}%</span>
                        </div>
                        <div class="journey-node is-organic is-active">
                            <span class="journey-node-title"><i class="fa-solid fa-circle-check"></i>Purchase</span>
                            <span class="journey-node-sub">${escapeHtml(purchaseBubble || 'no purchase')}</span>
                        </div>
                    </div>
                </div>
            `;
        }

        function wireJourneyRailInteractions() {}

        function wireJourneyChannelLegend() {
            const legend = document.getElementById('journey-channel-legend');
            if (!legend) return;
            const buttons = Array.from(legend.querySelectorAll('.journey-filter-channel'));
            if (!buttons.length) return;

            buttons.forEach((button) => {
                button.classList.toggle('is-active', button.getAttribute('data-channel') === attributionJourneyState.channel);
                button.onclick = () => {
                    const selected = button.getAttribute('data-channel') || 'all';
                    attributionJourneyState.channel = selected;
                    attributionJourneyState.profileKey = 'all';
                    renderAttributionJourneyPanel();
                };
            });
        }

        function normalizeProfileName(value) {
            return String(value || '')
                .trim()
                .toLowerCase()
                .replace(/[._-]+/g, ' ')
                .replace(/\s+/g, ' ');
        }

        function normalizeCustomerId(value) {
            const normalized = String(value || '').trim();
            if (!normalized) return '';
            if (/^\d+(\.0+)?$/.test(normalized)) {
                return String(parseInt(normalized, 10));
            }
            return normalized;
        }

        function getPurchaseSelectionKey(purchase = {}) {
            const orderId = String(purchase.orderId || '').trim();
            if (orderId) return `order:${orderId}`;

            const orderNumber = String(purchase.orderNumber || '').trim();
            if (orderNumber) return `order-number:${orderNumber}`;

            const checkoutToken = String(purchase.checkoutToken || '').trim();
            if (checkoutToken) return `checkout:${checkoutToken}`;

            const createdAt = String(purchase.platformCreatedAt || purchase.createdAt || '').trim();
            const userKey = String(purchase.userKey || '').trim();
            const customerId = String(purchase.customerId || '').trim();
            const revenue = String(Number(purchase.revenue || 0));
            return `fallback:${createdAt}:${userKey}:${customerId}:${revenue}`;
        }

        function escapeInlineSingleQuotedJs(value) {
            return String(value || '')
                .replace(/\\/g, '\\\\')
                .replace(/'/g, "\\'");
        }

        function rebuildJourneyProfileLookup(profiles = []) {
            const byCustomerId = new Map();
            const byUserKey = new Map();
            const byName = [];

            profiles.forEach((profile) => {
                const customerId = normalizeCustomerId(profile.customerId);
                if (customerId && !byCustomerId.has(customerId)) byCustomerId.set(customerId, profile);

                const userKeys = Array.isArray(profile.userKeys) ? profile.userKeys : [];
                userKeys.forEach((key) => {
                    const normalized = String(key || '').trim();
                    if (normalized && !byUserKey.has(normalized)) byUserKey.set(normalized, profile);
                });

                const normalizedName = normalizeProfileName(profile.customerDisplayName || profile.profileLabel || '');
                if (normalizedName) byName.push({ normalizedName, profile });
            });

            journeyProfileLookupState = {
                byCustomerId,
                byUserKey,
                byName,
            };
        }

        function createProfilePurchaseMatcher(profile = {}) {
            const profileCustomerId = normalizeCustomerId(profile.customerId);
            const profileUserKeys = new Set(
                (Array.isArray(profile.userKeys) ? profile.userKeys : [])
                    .map((k) => String(k || '').trim())
                    .filter(Boolean)
            );
            const profileName = normalizeProfileName(profile.customerDisplayName || profile.profileLabel || '');

            return (purchase = {}) => {
                const purchaseCustomerId = normalizeCustomerId(purchase.customerId);
                if (profileCustomerId && purchaseCustomerId && profileCustomerId === purchaseCustomerId) {
                    return true;
                }

                const purchaseUserKey = String(purchase.userKey || '').trim();
                if (purchaseUserKey && profileUserKeys.has(purchaseUserKey)) {
                    return true;
                }

                const purchaseName = normalizeProfileName(resolvePurchaseCustomerName(purchase));
                if (profileName && purchaseName && (profileName === purchaseName || profileName.includes(purchaseName) || purchaseName.includes(profileName))) {
                    return true;
                }

                return false;
            };
        }

        async function fetchJourneyWooProfiles(force = false) {
            if (!currentShopId) return;
            if (wooProfilesState.loading) return;
            if (!force && wooProfilesState.profiles.length > 0 && (Date.now() - wooProfilesState.loadedAt) < SESSION_OVERVIEW_CACHE_TTL_MS) {
                return;
            }

            wooProfilesState.loading = true;
            try {
                const res = await fetch(`/api/analytics/${currentShopId}/session-explorer?limit=500`);
                if (!res.ok) throw new Error(`status_${res.status}`);
                const data = await res.json();
                const profiles = Array.isArray(data?.profiles) ? data.profiles : [];
                wooProfilesState.profiles = profiles.filter((profile) => String(profile.profileType || '').toLowerCase() === 'woocommerce_customer');
                rebuildJourneyProfileLookup(wooProfilesState.profiles);
                wooProfilesState.loadedAt = Date.now();
            } catch (error) {
                console.warn('[Journey] Could not load Woo profiles for attribution center', error);
            } finally {
                wooProfilesState.loading = false;
            }
        }

        async function focusJourneyProfile({ userKey = '', customerId = '', sessionId = '', fallbackName = '' } = {}) {
            if (!wooProfilesState.profiles.length && !wooProfilesState.loading) {
                await fetchJourneyWooProfiles();
            }

            const profiles = Array.isArray(wooProfilesState.profiles) ? wooProfilesState.profiles : [];
            const safeSessionId = String(sessionId || '').trim();
            let safeCustomerId = normalizeCustomerId(customerId);
            let safeUserKey = String(userKey || '').trim();
            let safeFallbackName = String(fallbackName || '').trim();

            let matched = null;
            if (safeSessionId) {
                matched = profiles.find((profile) => String(profile.recentSessionId || '').trim() === safeSessionId) || null;
            }

            if (safeSessionId && (!safeCustomerId || !safeUserKey || !safeFallbackName)) {
                const purchases = Array.isArray(recentPurchasesState) ? recentPurchasesState : [];
                const linkedPurchase = purchases.find((purchase) => {
                    const purchaseSessionId = String(purchase.sessionId || '').trim();
                    if (purchaseSessionId && purchaseSessionId === safeSessionId) return true;
                    const stitched = Array.isArray(purchase.stitchedEvents) ? purchase.stitchedEvents : [];
                    return stitched.some((event) => String(event.sessionId || '').trim() === safeSessionId);
                }) || null;

                if (linkedPurchase) {
                    if (!safeCustomerId) safeCustomerId = normalizeCustomerId(linkedPurchase.customerId);
                    if (!safeUserKey) safeUserKey = String(linkedPurchase.userKey || '').trim();
                    if (!safeFallbackName) safeFallbackName = String(resolvePurchaseCustomerName(linkedPurchase) || '').trim();
                }
            }

            if (!matched && safeCustomerId) {
                matched = journeyProfileLookupState.byCustomerId.get(safeCustomerId) || null;
            }
            if (!matched && safeUserKey) {
                matched = journeyProfileLookupState.byUserKey.get(safeUserKey) || null;
            }
            if (!matched && safeFallbackName) {
                const targetName = normalizeProfileName(safeFallbackName);
                matched = journeyProfileLookupState.byName.find((entry) => {
                    return targetName && (entry.normalizedName.includes(targetName) || targetName.includes(entry.normalizedName));
                })?.profile || null;
            }

            attributionJourneyState.profileKey = matched?.profileKey || 'all';
            attributionJourneyState.selectedJourneyKey = '';
            if (matched?.customerDisplayName || safeFallbackName) {
                attributionJourneyState.profileSearch = matched?.customerDisplayName || safeFallbackName;
            }
            renderAttributionJourneyPanel();
        }

        function renderAttributionJourneyPanel() {
            const focusEl = document.getElementById('attribution-journey-focus');
            const historyEl = document.getElementById('attribution-journey-history');
            if (!focusEl || !historyEl) return;

            const activeInput = document.activeElement && document.activeElement.id === 'journey-profile-search' ? document.activeElement : null;
            const hadFocus = !!activeInput;
            const selectionStart = hadFocus ? activeInput.selectionStart : null;
            const selectionEnd = hadFocus ? activeInput.selectionEnd : null;

            wireJourneyChannelLegend();

            const currentData = sessionExplorerState.currentData;
            if (sessionExplorerState.mode === 'session' && currentData) {
                const journeyData = buildMinimalJourneyNodesFromSessionData(currentData, selectedJourneyTimelineMode);
                const currentJourney = currentData.journey || {};
                const currentSession = currentData.session || {};
                const peers = Array.isArray(currentData.peers) ? currentData.peers : [];
                const currentPerson = humanReadablePersonName(currentData?.identifiedUser?.customerDisplayName || currentData?.identifiedUser?.emailPreview || 'Customer');

                focusEl.innerHTML = `
                    <div class="journey-compact-card space-y-3">
                        <div class="flex items-center justify-between gap-2 flex-wrap">
                            <span class="journey-chip" data-tooltip="Current session status"><i class="fa-solid fa-route"></i>active</span>
                            <span class="text-xs text-gray-500">${formatDateTimeMx(currentSession.startedAt)}</span>
                        </div>
                        <div class="journey-meta-grid">
                            <span class="journey-chip" data-tooltip="Customer identifier from your system"><i class="fa-solid fa-user"></i>${escapeHtml(journeyData.summary?.userName || 'Customer')}</span>
                            <span class="journey-chip" data-tooltip="Attribution confidence score"><i class="fa-solid fa-percent"></i>${Number(journeyData.summary?.confidence || 0)}%</span>
                            <span class="journey-chip" data-tooltip="Campaign that led to conversion"><i class="fa-solid fa-bullhorn"></i>${escapeHtml(journeyData.summary?.sourceAd || 'No campaign')}</span>
                            <span class="journey-chip" data-tooltip="Initial landing page"><i class="fa-solid fa-door-open"></i>${escapeHtml(journeyData.summary?.landing || '-')}</span>
                            <span class="journey-chip" data-tooltip="Generated leads count"><i class="fa-solid fa-circle-plus"></i>Leads ${Number(journeyData.summary?.leads || 0)}</span>
                        </div>
                        ${renderTimelineModeToggle(selectedJourneyTimelineMode)}
                        ${renderJourneyVerticalTimeline(journeyData.timelineEvents)}
                        <div class="flex items-center gap-2 flex-wrap">
                            <span class="journey-chip ${resolveChannelTone(currentJourney.attribution?.channel, currentJourney.attribution?.platform)}" data-tooltip="Traffic source channel"><i class="fa-solid fa-bullseye"></i>${escapeHtml(humanReadableChannel(currentJourney.attribution?.channel || 'unattributed', currentJourney.attribution?.platform || ''))}</span>
                        </div>
                    </div>
                `;
                wireTimelineModeToggle(focusEl);

                const historicalRows = peers.slice(0, 10).map((peer, index) => `
                    <button type="button" class="journey-compact-card w-full text-left hover:opacity-95" onclick="focusJourneyProfile({ sessionId: '${escapeInlineSingleQuotedJs(peer.sessionId || '')}', fallbackName: '${escapeInlineSingleQuotedJs(currentPerson)}' })">
                        <div class="flex items-center justify-between gap-2">
                            <p class="text-sm font-semibold text-gray-900">${escapeHtml(`Session ${index + 1} for ${currentPerson}`)}</p>
                            <span class="text-xs text-gray-500">${formatDateTimeMx(peer.startedAt)}</span>
                        </div>
                        <div class="mt-2 flex items-center gap-2 flex-wrap">
                            <span class="journey-chip" data-tooltip="Campaign name from session"><i class="fa-solid fa-tags"></i>${escapeHtml(peer.utmCampaign || 'no campaign')}</span>
                            <span class="journey-chip" data-tooltip="Where user first landed"><i class="fa-solid fa-store"></i>${escapeHtml(peer.landingPageUrl ? new URL(peer.landingPageUrl, window.location.origin).pathname : 'no landing')}</span>
                        </div>
                    </button>
                `).join('');

                historyEl.innerHTML = historicalRows || '<p class="text-sm text-gray-500">No linked historical sessions yet for this user.</p>';
                return;
            }

            const rankedJourneys = (Array.isArray(recentPurchasesState) ? recentPurchasesState : [])
                .map((p) => ({
                    purchase: p,
                    score: scoreJourneySignal(p),
                    channelKey: normalizeAttributionChannel(p.attributedChannel || '', p.attributedPlatform || ''),
                    selectionKey: getPurchaseSelectionKey(p),
                }))
                .sort((a, b) => {
                    const tsA = new Date(a.purchase.platformCreatedAt || a.purchase.createdAt || 0).getTime();
                    const tsB = new Date(b.purchase.platformCreatedAt || b.purchase.createdAt || 0).getTime();
                    return tsB - tsA;
                });

            const byChannel = attributionJourneyState.channel === 'all'
                ? rankedJourneys
                : rankedJourneys.filter((row) => row.channelKey === attributionJourneyState.channel);

            const recentCustomerNamesById = new Map();
            rankedJourneys.forEach(({ purchase }) => {
                const customerId = normalizeCustomerId(purchase?.customerId);
                const resolvedName = resolvePurchaseCustomerName(purchase);
                if (customerId && resolvedName && !recentCustomerNamesById.has(customerId)) {
                    recentCustomerNamesById.set(customerId, resolvedName);
                }
            });

            const resolveProfileDisplayName = (profile = {}) => {
                const customerId = normalizeCustomerId(profile.customerId);
                return profile.customerDisplayName
                    || (customerId ? recentCustomerNamesById.get(customerId) || null : null)
                    || profile.profileLabel
                    || (customerId ? `Woo #${customerId}` : 'Woo customer');
            };

            const allWooProfiles = Array.isArray(wooProfilesState.profiles) ? wooProfilesState.profiles : [];
            const normalizedSearch = normalizeProfileName(attributionJourneyState.profileSearch || '');
            const visibleProfilesBase = allWooProfiles.filter((profile) => {
                if (!normalizedSearch) return true;
                const resolvedLabel = resolveProfileDisplayName(profile);
                const label = normalizeProfileName(resolvedLabel || '');
                const customerId = normalizeCustomerId(profile.customerId);
                return label.includes(normalizedSearch) || customerId.includes(normalizedSearch);
            });

            const visibleProfiles = visibleProfilesBase.slice().sort((a, b) => {
                const mode = String(attributionJourneyState.profileSort || 'orders');
                if (mode === 'revenue') return Number(b.totalRevenue || 0) - Number(a.totalRevenue || 0);
                if (mode === 'recent') return new Date(b.lastSeenAt || 0).getTime() - new Date(a.lastSeenAt || 0).getTime();
                return Number(b.orderCount || 0) - Number(a.orderCount || 0);
            });

            const availableProfileKeys = new Set(['all', ...visibleProfiles.map((profile) => String(profile.profileKey || '').trim()).filter(Boolean)]);
            if (!availableProfileKeys.has(String(attributionJourneyState.profileKey || 'all'))) {
                attributionJourneyState.profileKey = 'all';
            }

            const selectedProfile = visibleProfiles.find((profile) => String(profile.profileKey || '') === String(attributionJourneyState.profileKey || 'all')) || null;
            const selectedProfileMatcher = selectedProfile ? createProfilePurchaseMatcher(selectedProfile) : null;
            const profileFilteredJourneys = selectedProfile
                ? byChannel.filter(({ purchase }) => selectedProfileMatcher(purchase))
                : byChannel;

            if (!byChannel.length) {
                attributionJourneyState.selectedJourneyKey = '';
                focusEl.innerHTML = '<p class="text-sm text-gray-500">No conversion journeys found in this date range.</p>';
                historyEl.innerHTML = '<p class="text-sm text-gray-500">No WooCommerce conversion profiles found yet.</p>';
                return;
            }

            if (!profileFilteredJourneys.length) {
                if (selectedProfile) {
                    attributionJourneyState.selectedJourneyKey = '';
                    focusEl.innerHTML = `
                        <div class="journey-compact-card space-y-3">
                            <div class="flex items-center justify-between gap-2 flex-wrap">
                                <span class="journey-chip"><i class="fa-solid fa-user"></i>${escapeHtml(resolveProfileDisplayName(selectedProfile))}</span>
                                <span class="text-xs text-gray-500">${formatDateTimeMx(selectedProfile.lastSeenAt)}</span>
                            </div>
                            <div class="journey-meta-grid">
                                <span class="journey-chip"><i class="fa-solid fa-bag-shopping"></i>${Number(selectedProfile.orderCount || 0)} orders</span>
                                <span class="journey-chip"><i class="fa-solid fa-chart-line"></i>${formatCurrency(Number(selectedProfile.totalRevenue || 0))}</span>
                                <span class="journey-chip"><i class="fa-solid fa-clock"></i>${formatDateTimeMx(selectedProfile.lastOrderAt)}</span>
                            </div>
                            <p class="text-sm text-gray-500">This profile is detected, but there are no stitched purchase journeys in the current channel/date filter yet.</p>
                        </div>
                    `;
                } else {
                    attributionJourneyState.selectedJourneyKey = '';
                    focusEl.innerHTML = '<p class="text-sm text-gray-500">No stitched journeys for this filter.</p>';
                }
            } else {
                const selectedRow = profileFilteredJourneys.find((row) => row.selectionKey === String(attributionJourneyState.selectedJourneyKey || ''))
                    || profileFilteredJourneys[0];
                attributionJourneyState.selectedJourneyKey = selectedRow?.selectionKey || '';
                focusEl.innerHTML = renderFocusedPurchaseJourneyCard(
                    selectedRow.purchase,
                    selectedProfile ? resolveProfileDisplayName(selectedProfile) : ''
                );
                wireTimelineModeToggle(focusEl);
            }

            historyEl.innerHTML = `
                <div class="space-y-3">
                    <div class="flex items-center gap-2 flex-wrap">
                        <input id="journey-profile-search" type="text" class="text-xs border border-gray-300 rounded-md px-2 py-1 bg-white" placeholder="Search Woo profile" value="${escapeHtmlAttr(attributionJourneyState.profileSearch || '')}">
                        <select id="journey-profile-sort" class="text-xs border border-gray-300 rounded-md px-2 py-1 bg-white">
                            <option value="orders" ${attributionJourneyState.profileSort === 'orders' ? 'selected' : ''}>Mas orders</option>
                            <option value="revenue" ${attributionJourneyState.profileSort === 'revenue' ? 'selected' : ''}>Mayor revenue</option>
                            <option value="recent" ${attributionJourneyState.profileSort === 'recent' ? 'selected' : ''}>Mas reciente</option>
                        </select>
                    </div>
                    <div class="journey-customer-bubbles max-h-36 overflow-y-auto pr-1">
                        <button type="button" class="journey-customer-bubble ${attributionJourneyState.profileKey === 'all' ? 'is-active' : ''}" data-profile-key="all">All Woo profiles</button>
                        ${visibleProfiles.map((profile) => {
                            const active = String(attributionJourneyState.profileKey || 'all') === String(profile.profileKey || '');
                            const label = resolveProfileDisplayName(profile);
                            return `<button type="button" class="journey-customer-bubble ${active ? 'is-active' : ''}" data-profile-key="${escapeHtmlAttr(profile.profileKey || '')}" title="${escapeHtmlAttr(label)} · ${Number(profile.orderCount || 0)} orders">${escapeHtml(label)}</button>`;
                        }).join('')}
                    </div>
                </div>
                <div class="space-y-3 mt-3">
                    ${profileFilteredJourneys.slice(0, 20).map(({ purchase, selectionKey }) => {
                        const identity = resolvePurchaseDisplayIdentity(purchase);
                        const sessionCount = countPurchaseJourneySessions(purchase);
                        const isActive = selectionKey === String(attributionJourneyState.selectedJourneyKey || '');
                        return `
                        <button type="button" class="journey-compact-card ${isActive ? 'is-active' : ''} w-full text-left hover:opacity-95" data-journey-key="${escapeHtmlAttr(selectionKey)}">
                            <div class="flex items-center justify-between gap-2 flex-wrap">
                                <div class="min-w-0">
                                    <p class="text-sm font-semibold text-gray-900 truncate">${escapeHtml(identity.name)}</p>
                                    ${identity.email ? `<p class="mt-1 text-xs text-gray-500 truncate">${escapeHtml(identity.email)}</p>` : ''}
                                </div>
                                <span class="text-xs text-gray-500">${formatRecentPurchaseDate(purchase)}</span>
                            </div>
                            <div class="mt-2 flex items-center gap-2 flex-wrap">
                                <span class="journey-chip ${resolveChannelTone(purchase.attributedChannel, purchase.attributedPlatform)}"><i class="${resolveChannelIcon(purchase.attributedChannel, purchase.attributedPlatform)}"></i>${escapeHtml(humanReadableChannel(purchase.attributedChannel || 'unattributed', purchase.attributedPlatform || ''))}</span>
                                <span class="journey-chip"><i class="fa-solid fa-sack-dollar"></i>${formatCurrencyWithCode(Number(purchase.revenue || 0), purchase.currency || 'MXN')}</span>
                                <span class="journey-chip"><i class="fa-solid fa-layer-group"></i>${sessionCount} sessions</span>
                            </div>
                        </button>`;
                    }).join('') || '<p class="text-sm text-gray-500">No stitched purchases for this profile yet.</p>'}
                </div>
            `;

            const profileSearchInput = historyEl.querySelector('#journey-profile-search');
            if (profileSearchInput) {
                if (hadFocus) {
                    profileSearchInput.focus();
                    try { profileSearchInput.setSelectionRange(selectionStart, selectionEnd); } catch(e) {}
                }
                profileSearchInput.addEventListener('input', (event) => {
                    const nextValue = event.target.value || '';
                    if (journeyProfileSearchDebounceTimer) clearTimeout(journeyProfileSearchDebounceTimer);
                    journeyProfileSearchDebounceTimer = setTimeout(() => {
                        attributionJourneyState.profileSearch = nextValue;
                        renderAttributionJourneyPanel();
                    }, 120);
                });
            }

            const profileSortSelect = historyEl.querySelector('#journey-profile-sort');
            if (profileSortSelect) {
                profileSortSelect.addEventListener('change', (event) => {
                    attributionJourneyState.profileSort = event.target.value || 'orders';
                    renderAttributionJourneyPanel();
                });
            }

            historyEl.querySelectorAll('[data-profile-key]').forEach((button) => {
                button.addEventListener('click', () => {
                    attributionJourneyState.profileKey = button.getAttribute('data-profile-key') || 'all';
                    renderAttributionJourneyPanel();
                });
            });

            historyEl.querySelectorAll('[data-journey-key]').forEach((button) => {
                button.addEventListener('click', () => {
                    const selectionKey = button.getAttribute('data-journey-key') || '';
                    const row = profileFilteredJourneys.find((item) => item.selectionKey === selectionKey);
                    if (!row) return;
                    attributionJourneyState.selectedJourneyKey = row.selectionKey;
                    renderAttributionJourneyPanel();
                });
            });
        }

        async function fetchWordPressUsersOnline(force = false) {
            if (!currentShopId) return;
            if (wpUsersFetchInFlight) return;

            const now = Date.now();
            if (!force && (now - wpUsersLastFetchAt) < WP_USERS_FETCH_MIN_INTERVAL_MS) return;
            wpUsersFetchInFlight = true;
            wpUsersLastFetchAt = now;

            try {
                const res = await fetch(`/api/analytics/${currentShopId}/wordpress-users-online?window_minutes=30&limit=6`);
                if (!res.ok) throw new Error(`status_${res.status}`);
                const data = await res.json();
                const users = Array.isArray(data?.users) ? data.users : [];
                storeTypeSignals.sawWordPressEndpoint = true;
                if (users.length > 0) storeTypeSignals.sawWordPressUsers = true;
                updateShopHeader(currentShopId, 'woocommerce');

                if (!users.length) {
                    wpUsersOnlineState = {
                        users: [],
                        updatedAt: new Date().toISOString(),
                        hasError: false,
                    };
                    renderWordPressUsersOnlineState({
                        countText: '0',
                        statusText: 'No users connected',
                        statusClass: 'text-gray-500',
                        users: [],
                    });
                    if (sessionExplorerState.mode === 'overview' && sessionExplorerState.overview) {
                        renderProfilePriorityBanner('overview', sessionExplorerState.overview);
                    }
                    return;
                }

                wpUsersOnlineState = {
                    users,
                    updatedAt: new Date().toISOString(),
                    hasError: false,
                };
                renderWordPressUsersOnlineState({
                    countText: String(users.length),
                    statusText: '',
                    statusClass: 'text-emerald-600',
                    users,
                });
                if (sessionExplorerState.mode === 'overview' && sessionExplorerState.overview) {
                    renderProfilePriorityBanner('overview', sessionExplorerState.overview);
                }
            } catch (error) {
                console.error('[WP Online Users] Error:', error);
                wpUsersOnlineState = {
                    users: [],
                    updatedAt: new Date().toISOString(),
                    hasError: true,
                };
                renderWordPressUsersOnlineState({
                    countText: '!',
                    statusText: 'Could not fetch online users. Check /collect or the analytics API.',
                    statusClass: 'text-rose-600',
                    users: [],
                });
                if (sessionExplorerState.mode === 'overview' && sessionExplorerState.overview) {
                    renderProfilePriorityBanner('overview', sessionExplorerState.overview);
                }
            } finally {
                wpUsersFetchInFlight = false;
            }
        }

        function initializeMetricCarousel() {
            const viewport = document.getElementById('metric-carousel-viewport');
            const prev = document.getElementById('metric-carousel-prev');
            const next = document.getElementById('metric-carousel-next');
            prev?.addEventListener('click', () => moveMetricCarousel(-1));
            next?.addEventListener('click', () => moveMetricCarousel(1));
            viewport?.addEventListener('scroll', updateMetricCarousel, { passive: true });
            window.addEventListener('resize', () => {
                syncMetricCarouselViewport();
                updateMetricCarousel();
            });
            syncMetricCarouselViewport();
            updateMetricCarousel();
        }

        function syncMetricCarouselViewport() {
            if (window.innerWidth >= 1024) metricCarouselVisible = 4;
            else if (window.innerWidth >= 640) metricCarouselVisible = 2;
            else metricCarouselVisible = 1;
        }

        function moveMetricCarousel(direction) {
            const viewport = document.getElementById('metric-carousel-viewport');
            if (!viewport) return;

            const step = Math.max(280, Math.floor(viewport.clientWidth * 0.9));
            viewport.scrollBy({ left: direction * step, behavior: 'smooth' });
        }

        function updateMetricCarousel() {
            const viewport = document.getElementById('metric-carousel-viewport');
            const slides = document.querySelectorAll('.metric-card-slide');
            if (!viewport || slides.length === 0) return;

            const slideWidth = slides[0].getBoundingClientRect().width || 1;
            metricCarouselIndex = Math.round(viewport.scrollLeft / slideWidth);
            const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
            const prev = document.getElementById('metric-carousel-prev');
            const next = document.getElementById('metric-carousel-next');
            if (prev) prev.disabled = viewport.scrollLeft <= 4;
            if (next) next.disabled = viewport.scrollLeft >= (maxScrollLeft - 4);
        }

        function initializeSessionDetailPanel() {
            const closeBtn = document.getElementById('session-detail-close');
            const prevBtn = document.getElementById('session-peer-prev');
            const nextBtn = document.getElementById('session-peer-next');
            const timelineFilter = document.getElementById('session-timeline-filter');
            const clearCompareBtn = document.getElementById('session-compare-clear');
            const recommendedCompareBtn = document.getElementById('session-compare-recommended');
            closeBtn?.addEventListener('click', closeSessionDetailPanel);
            prevBtn?.addEventListener('click', () => navigatePeerSession(-1));
            nextBtn?.addEventListener('click', () => navigatePeerSession(1));
            timelineFilter?.addEventListener('change', renderSessionTimelineFromState);
            clearCompareBtn?.addEventListener('click', clearSessionComparison);
            recommendedCompareBtn?.addEventListener('click', async () => {
                const sessionId = recommendedCompareBtn.getAttribute('data-session-id');
                if (sessionId) await loadComparisonSession(sessionId, recommendedCompareBtn);
            });
        }

        function openSessionDetailPanel() {
            const panel = document.getElementById('session-detail-panel');
            panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        function closeSessionDetailPanel() {
            loadSessionExplorerOverview();
        }

        async function fetchSessionExplorerOverviewData() {
            const res = await fetch(`/api/analytics/${currentShopId}/session-explorer?limit=12`);
            if (!res.ok) throw new Error('Could not load explorer history');
            const data = await res.json();
            console.info('[Session Explorer] overview payload', {
                shopId: currentShopId,
                totalProfiles: data?.summary?.totalProfiles || 0,
                totalSessions: data?.summary?.totalSessions || 0,
                totalOrders: data?.summary?.totalOrders || 0,
                resolvedCustomerNames: data?.summary?.resolvedCustomerNames || 0,
                shopifyNameLookupActive: Boolean(data?.summary?.shopifyNameLookupActive),
                wooProfiles: Array.isArray(data?.profiles) ? data.profiles.filter((item) => item.profileType === 'woocommerce_customer').length : 0,
                profilesWithOrders: Array.isArray(data?.profiles) ? data.profiles.filter((item) => Number(item.orderCount || 0) > 0).length : 0,
            });
            return data;
        }

        function renderSessionExplorerOverview(data) {
            const summary = data?.summary || {};
            const profiles = Array.isArray(data?.profiles) ? data.profiles : [];
            const storePlatform = String(summary.storePlatform || 'CUSTOM').toUpperCase();
            if (currentShopId) updateShopHeader(currentShopId, storePlatform);
            const wooProfiles = profiles.filter((item) => item.profileType === 'woocommerce_customer').length;
            const orderLedProfiles = profiles.filter((item) => Number(item.orderCount || 0) > 0).length;
            const resolvedCustomerNames = Number(summary.resolvedCustomerNames || 0);
            const shopifyNameLookupActive = Boolean(summary.shopifyNameLookupActive);
            const topProfile = profiles[0] || null;
            const topCampaigns = profiles.filter((item) => item.lastCampaign).slice(0, 4);
            const topLandings = profiles.filter((item) => item.lastLandingPageUrl).slice(0, 4);
            const isWooStore = storePlatform === 'WOOCOMMERCE';
            const titleText = isWooStore
                ? 'WooCommerce profiles detected through orders and linked web sessions'
                : 'Historical profiles and linked web sessions';
            const viewDescription = isWooStore
                ? 'These chips represent WooCommerce profiles enriched with web sessions when the pixel successfully links them.'
                : 'These chips represent historical profiles detected from web sessions and identity signals.';
            const orderDescription = isWooStore
                ? 'In WooCommerce we prioritize profiles with orders first and then the most recent linked web session.'
                : 'This list prioritizes profiles with a recent linked web session and then the rest of the history.';
            const nameDescription = isWooStore
                ? (resolvedCustomerNames > 0
                    ? `${resolvedCustomerNames} Woo profiles already include readable names saved from order synchronization.`
                    : 'Readable Woo names are not available in this batch yet; older orders may require resynchronization to replace technical IDs.')
                : (shopifyNameLookupActive
                    ? `Shopify name lookup active, ${resolvedCustomerNames} names resolved in this batch.`
                    : 'There is no usable Shopify token to resolve displayName, so only the technical profile is shown.');

            console.info('[Session Explorer] rendering overview', {
                totalProfiles: profiles.length,
                wooProfiles,
                orderLedProfiles,
                topProfile: topProfile?.profileKey || null,
            });
            if (!wooProfiles || !orderLedProfiles) {
                console.warn('[Session Explorer] overview without Woo coverage', {
                    wooProfiles,
                    orderLedProfiles,
                    sampleProfiles: profiles.slice(0, 5).map((item) => ({
                        profileKey: item.profileKey,
                        profileType: item.profileType,
                        orderCount: item.orderCount,
                        sessionCount: item.sessionCount,
                    })),
                });
            }

            sessionExplorerState.mode = 'overview';
            sessionExplorerState.overview = data;
            sessionExplorerState.currentSessionId = null;
            sessionExplorerState.currentSessionStartedAt = null;
            sessionExplorerState.peers = [];
            sessionExplorerState.timeline = [];
            sessionExplorerState.currentData = null;
            sessionExplorerState.compareData = null;

            renderProfilePriorityBanner('overview', data);
            const overviewRecommendations = profiles
                .slice(0, 3)
                .flatMap((profile) => Array.isArray(profile.actionRecommendations) ? profile.actionRecommendations.slice(0, 1) : []);
            renderAttributionJourneyPanel();
            document.getElementById('session-detail-actions').innerHTML = renderActionCards(overviewRecommendations);
            document.getElementById('session-detail-affinity').innerHTML = renderAffinityCards(
                profiles[0]?.topProducts || [],
                profiles[0]?.topPairings || []
            );

            document.getElementById('session-detail-title').textContent = titleText;
            document.getElementById('session-detail-metrics').innerHTML = [
                { label: 'Profiles', value: summary.totalProfiles || 0 },
                { label: 'Recent sessions', value: summary.totalSessions || 0 },
                { label: 'Historical orders', value: summary.totalOrders || 0 },
                { label: 'Historical revenue', value: formatCurrency(summary.totalRevenue || 0) },
            ].map((item) => `
                <div class="session-metric-card rounded-xl p-4">
                    <div class="text-xs uppercase tracking-wide text-gray-500">${item.label}</div>
                    <div class="session-metric-card-value mt-2 text-2xl font-semibold text-gray-900">${item.value}</div>
                </div>
            `).join('');

            document.getElementById('session-detail-summary').innerHTML = `
                <p><strong>Status:</strong> Persistent explorer in historical mode.</p>
                <p><strong>Detected platform:</strong> ${storePlatform}</p>
                <p><strong>What you are seeing:</strong> ${viewDescription}</p>
                <p><strong>Woo profiles:</strong> ${wooProfiles} of ${profiles.length || 0}</p>
                <p><strong>Profiles with purchases:</strong> ${orderLedProfiles}</p>
                <p><strong>Most recent profile:</strong> ${topProfile?.profileLabel || '-'}</p>
                <p><strong>Last activity:</strong> ${formatDateTimeMx(topProfile?.lastSeenAt)}</p>
                <p><strong>Suggested session:</strong> ${topProfile?.recentSessionId || '-'}</p>
                <p><strong>Current order:</strong> ${orderDescription}</p>
                <p><strong>Readout:</strong> if you see "0 sessions," the platform knows that customer through orders, but the pixel still has not linked them to a captured web session.</p>
                <p><strong>Customer name:</strong> ${nameDescription}</p>
            `;

            document.getElementById('session-detail-orders').innerHTML = profiles.length
                ? profiles.slice(0, 6).map((profile) => `
                    <div class="session-order-card rounded-lg p-3">
                        <div class="flex items-start justify-between gap-3">
                            <div>
                                <p class="font-medium text-gray-900">${profile.profileLabel || 'Historical profile'}</p>
                                <p class="text-sm text-gray-500">${profile.orderCount || 0} orders · ${profile.sessionCount || 0} sessions${Number(profile.sessionCount || 0) === 0 ? ' · without a linked web session' : ''}</p>
                                <p class="text-xs text-gray-400">${profile.lastSeenAt ? formatDateTimeMx(profile.lastSeenAt) : 'No recent activity'}</p>
                            </div>
                            <div class="text-right">
                                <p class="text-sm font-semibold text-indigo-600">${formatCurrency(profile.totalRevenue || 0)}</p>
                                ${profile.recentSessionId ? `<button type="button" class="session-compare-pill historical-profile-trigger inline-flex items-center px-2 py-1 mt-2 text-xs" data-session-id="${profile.recentSessionId}">Open session</button>` : ''}
                            </div>
                        </div>
                    </div>
                `).join('')
                : '<p class="text-gray-500">There are not enough historical profiles yet.</p>';

            document.getElementById('session-detail-attribution').innerHTML = `
                <p><strong>Woo customers:</strong> ${wooProfiles}</p>
                <p><strong>Profiles by email hash:</strong> ${profiles.filter((item) => item.profileType === 'email_hash').length}</p>
                <p><strong>Profiles by phone hash:</strong> ${profiles.filter((item) => item.profileType === 'phone_hash').length}</p>
                <p><strong>Browser key only:</strong> ${profiles.filter((item) => item.profileType === 'user_key').length}</p>
                <p><strong>Signal useful:</strong> the backend already blends sessions, orders, and stored identity and adapts the readout to the detected store type.</p>
            `;

            document.getElementById('session-detail-journey').innerHTML = `
                <div>
                    <p class="font-medium text-gray-900 mb-1">Recent landings</p>
                    ${topLandings.length
                        ? topLandings.map((item) => `<p class="text-xs text-gray-600 truncate">${item.lastLandingPageUrl} · ${item.profileLabel}</p>`).join('')
                        : '<p class="text-xs text-gray-500">No highlighted landings.</p>'}
                </div>
                <div>
                    <p class="font-medium text-gray-900 mb-1">Recent campaigns</p>
                    ${topCampaigns.length
                        ? topCampaigns.map((item) => `<p class="text-xs text-gray-600">${item.lastCampaign} · ${item.profileLabel}</p>`).join('')
                        : '<p class="text-xs text-gray-500">No recurring campaigns.</p>'}
                </div>
            `;

            document.getElementById('session-detail-visual').innerHTML = profiles.length
                ? `<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">${profiles.slice(0, 4).map((profile) => `
                    <div class="session-side-card rounded-xl p-4">
                        <p class="text-sm font-semibold text-gray-900">${profile.profileLabel || 'Profile'}</p>
                        <p class="text-xs text-gray-500 mt-1">${profile.profileType || 'user_key'}</p>
                        <p class="mt-3 text-sm text-gray-600">${profile.sessionCount || 0} sessions · ${profile.orderCount || 0} orders</p>
                        <p class="text-sm text-indigo-600">${formatCurrency(profile.totalRevenue || 0)}</p>
                    </div>
                `).join('')}</div>`
                : '<p class="text-sm text-gray-500">No profiles to visualize yet.</p>';

            document.getElementById('session-detail-patterns').innerHTML = `
                <div class="session-pattern-item rounded-xl p-4">
                    <p class="text-sm font-semibold text-gray-900">The explorer no longer depends on a single session</p>
                    <p class="mt-1 text-sm text-gray-600">It starts by showing historical profiles and then drills into the details when you choose a session.</p>
                </div>
                <div class="session-pattern-item rounded-xl p-4">
                    <p class="text-sm font-semibold text-gray-900">Identity now blends more signals</p>
                    <p class="mt-1 text-sm text-gray-600">Woo customer, email hash, phone hash, and userKey now feed the historical context.</p>
                </div>
                <div class="session-pattern-item rounded-xl p-4">
                    <p class="text-sm font-semibold text-gray-900">Recommended use</p>
                    <p class="mt-1 text-sm text-gray-600">Open a profile with orders first, then compare related sessions to detect friction or real intent.</p>
                </div>
            `;

            document.getElementById('session-detail-timeline').innerHTML = profiles.length
                ? profiles.map((profile) => `
                    <div class="session-timeline-item rounded-lg p-3">
                        <div class="flex items-center justify-between gap-4">
                            <div>
                                <p class="font-medium text-gray-900">${profile.profileLabel || 'Historical profile'}</p>
                                <p class="text-xs text-gray-500">${profile.sessionCount || 0} sessions · ${profile.orderCount || 0} orders</p>
                            </div>
                            <div class="text-right">
                                <p class="text-sm text-gray-700">${formatDateTimeMx(profile.lastSeenAt)}</p>
                                <p class="text-xs text-gray-400">${profile.profileType || 'user_key'}</p>
                            </div>
                        </div>
                    </div>
                `).join('')
                : '<p class="text-gray-500">There is not enough historical activity yet.</p>';

            renderPeerSessions(profiles, null, {});
            updatePeerNavigation([], null);
            renderSessionComparison();

            document.querySelectorAll('.historical-profile-trigger').forEach((button) => {
                button.addEventListener('click', () => {
                    const sessionId = button.getAttribute('data-session-id');
                    if (sessionId) focusJourneyProfile({ sessionId });
                });
            });
        }

        async function loadSessionExplorerOverview() {
            if (!currentShopId) return;
            if (overviewFetchInFlight) return;
            if (
                sessionExplorerState.mode === 'overview'
                && sessionExplorerState.overview
                && (Date.now() - sessionOverviewLastLoadedAt) < SESSION_OVERVIEW_CACHE_TTL_MS
            ) {
                return;
            }

            overviewFetchInFlight = true;
            try {
                const data = await fetchSessionExplorerOverviewData();
                renderSessionExplorerOverview(data);
                sessionOverviewLastLoadedAt = Date.now();
            } catch (error) {
                document.getElementById('session-detail-title').textContent = 'Historical users';
                document.getElementById('session-detail-metrics').innerHTML = '<div class="text-sm text-gray-500">Could not load the historical overview.</div>';
                document.getElementById('session-detail-summary').innerHTML = `<p class="text-red-600">${error.message}</p>`;
                document.getElementById('session-detail-orders').innerHTML = '<p class="text-gray-500">-</p>';
                document.getElementById('session-detail-attribution').innerHTML = '<p class="text-gray-500">-</p>';
                document.getElementById('session-detail-journey').innerHTML = '<p class="text-gray-500">-</p>';
                document.getElementById('session-detail-visual').innerHTML = '<p class="text-gray-500">-</p>';
                document.getElementById('session-detail-patterns').innerHTML = '<p class="text-gray-500">-</p>';
                document.getElementById('session-detail-timeline').innerHTML = '<p class="text-gray-500">-</p>';
                document.getElementById('session-detail-actions').innerHTML = '<p class="text-gray-500">-</p>';
                document.getElementById('session-detail-affinity').innerHTML = '<p class="text-gray-500">-</p>';
                renderPeerSessions([], null, {});
                renderSessionComparison();
            } finally {
                overviewFetchInFlight = false;
            }
        }

        async function openSessionDetail(sessionId) {
            if (!sessionId) return;
            focusJourneyProfile({ sessionId });
        }

        function describeTrackedUtmEntry(entry = {}) {
            const sourceMedium = [entry.utmSource, entry.utmMedium].filter(Boolean).join(' / ');
            const campaign = String(entry.utmCampaign || '').trim();
            const clickId = String(entry.clickId || entry.fbclid || entry.gclid || entry.ttclid || '').trim();
            const parts = [];

            if (sourceMedium) parts.push(sourceMedium);
            if (campaign) parts.push(campaign);
            if (clickId) parts.push(`click ${shortenJourneyIdentifier(clickId)}`);

            return parts.join(' · ') || 'Tracked UTM touch';
        }

        function normalizeTrackedHistoryUrl(value) {
            const raw = String(value || '').trim();
            if (!raw) return null;

            try {
                const parsed = new URL(raw, window.location.origin);
                parsed.hash = '';
                return parsed.toString();
            } catch (_) {
                return raw.split('#')[0] || null;
            }
        }

        function trackedHistoryHasSignals(url) {
            const normalized = normalizeTrackedHistoryUrl(url);
            if (!normalized) return false;

            try {
                const parsed = new URL(normalized, window.location.origin);
                const params = parsed.searchParams;
                return [
                    'utm_source',
                    'utm_medium',
                    'utm_campaign',
                    'utm_content',
                    'utm_term',
                    'fbclid',
                    'gclid',
                    'ttclid',
                    'ga4_session_source',
                ].some((key) => params.has(key) && params.get(key));
            } catch (_) {
                return false;
            }
        }

        function parseTrackedHistoryArray(value) {
            if (Array.isArray(value)) return value;
            if (typeof value !== 'string' || !value.trim()) return [];

            try {
                const parsed = JSON.parse(value);
                return Array.isArray(parsed) ? parsed : [];
            } catch (_) {
                return [];
            }
        }

        function normalizeTrackedHistoryEntry(entry = {}, fallback = {}) {
            const url = normalizeTrackedHistoryUrl(
                entry.url
                || entry.page_url
                || entry.pageUrl
                || entry.u
                || fallback.url
                || ''
            );

            if (!url || !trackedHistoryHasSignals(url)) return null;

            let parsed;
            try {
                parsed = new URL(url, window.location.origin);
            } catch (_) {
                parsed = null;
            }

            const params = parsed ? parsed.searchParams : new URLSearchParams();
            const clickId = String(
                entry.click_id
                || entry.clickId
                || entry.fbclid
                || entry.gclid
                || entry.ttclid
                || params.get('fbclid')
                || params.get('gclid')
                || params.get('ttclid')
                || fallback.clickId
                || ''
            ).trim();

            return {
                sessionId: String(entry.session_id || entry.sessionId || fallback.sessionId || '').trim() || null,
                capturedAt: String(entry.captured_at || entry.capturedAt || entry.ts || fallback.capturedAt || '').trim() || null,
                url,
                utmSource: String(entry.utm_source || entry.utmSource || params.get('utm_source') || fallback.utmSource || '').trim() || null,
                utmMedium: String(entry.utm_medium || entry.utmMedium || params.get('utm_medium') || fallback.utmMedium || '').trim() || null,
                utmCampaign: String(entry.utm_campaign || entry.utmCampaign || params.get('utm_campaign') || fallback.utmCampaign || '').trim() || null,
                utmContent: String(entry.utm_content || entry.utmContent || params.get('utm_content') || fallback.utmContent || '').trim() || null,
                utmTerm: String(entry.utm_term || entry.utmTerm || params.get('utm_term') || fallback.utmTerm || '').trim() || null,
                ga4SessionSource: String(entry.ga4_session_source || entry.ga4SessionSource || params.get('ga4_session_source') || fallback.ga4SessionSource || '').trim() || null,
                fbclid: String(entry.fbclid || params.get('fbclid') || fallback.fbclid || '').trim() || null,
                gclid: String(entry.gclid || params.get('gclid') || fallback.gclid || '').trim() || null,
                ttclid: String(entry.ttclid || params.get('ttclid') || fallback.ttclid || '').trim() || null,
                clickId: clickId || null,
            };
        }

        function renderTrackedUtmHistory(history = {}, options = {}) {
            const sessions = Array.isArray(history.sessions) ? history.sessions : [];
            if (!sessions.length) {
                return `<p class="text-xs text-gray-500">${escapeHtml(options.emptyMessage || 'No UTM URLs have been captured yet for this recognized user.')}</p>`;
            }

            return `
                <div class="space-y-3 mt-3">
                    <div class="flex items-center gap-2 flex-wrap">
                        <span class="journey-chip"><i class="fa-solid fa-link"></i>${Number(history.totalUrls || 0)} UTM URLs</span>
                        <span class="journey-chip"><i class="fa-solid fa-layer-group"></i>${Number(history.sessionCount || 0)} sessions</span>
                    </div>
                    ${sessions.slice(0, 6).map((session, index) => `
                        <div class="session-side-card rounded-xl p-3">
                            <div class="flex items-center justify-between gap-2 flex-wrap">
                                <p class="text-xs font-semibold uppercase tracking-wide text-gray-500">${session.isCurrentSession ? 'Current session' : `Linked session ${index + 1}`}</p>
                                <span class="text-[11px] text-gray-500">${formatDateTimeMx(session.startedAt || session.lastEventAt)}</span>
                            </div>
                            <div class="mt-2 space-y-2">
                                ${Array.isArray(session.urls) ? session.urls.slice(0, 4).map((entry) => `
                                    <div class="rounded-lg border border-white/10 bg-white/5 p-2">
                                        <p class="text-[11px] text-gray-400">${escapeHtml(describeTrackedUtmEntry(entry))}</p>
                                        <a href="${escapeHtmlAttr(entry.url || '#')}" target="_blank" rel="noopener noreferrer" class="block mt-1 text-xs break-all text-indigo-200 hover:underline">${escapeHtml(entry.url || '-')}</a>
                                        <p class="text-[11px] text-gray-500 mt-1">${formatDateTimeMx(entry.capturedAt || session.startedAt || session.lastEventAt)}</p>
                                    </div>
                                `).join('') : ''}
                                ${Number(session.touchCount || 0) > 4 ? `<p class="text-[11px] text-gray-500">+${Number(session.touchCount || 0) - 4} more tracked URLs in this session.</p>` : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        function renderSessionDetail(data) {
            const session = data.session || {};
            const metrics = data.metrics || {};
            const journey = data.journey || {};
            const patterns = data.patterns || {};
            const profile = data.profile || {};
            const peers = Array.isArray(data.peers) ? data.peers : [];
            const orders = Array.isArray(data.orders) ? data.orders : [];
            const timeline = Array.isArray(data.timeline) ? data.timeline : [];
            const pages = Array.isArray(journey.pages) ? journey.pages : [];
            const products = Array.isArray(journey.products) ? journey.products : [];
            const utmHistory = data.utmHistory || {};

            console.info('[Session Explorer] render session detail', {
                sessionId: session.sessionId || null,
                profileKey: profile.profileKey || null,
                profileType: profile.profileType || null,
                historicalOrderCount: profile.historicalOrderCount || 0,
                relatedSessionCount: profile.relatedSessionCount || 0,
                currentOrders: orders.filter((item) => item.isCurrentSession).length,
                historicalOrders: orders.filter((item) => !item.isCurrentSession).length,
            });

            sessionExplorerState.mode = 'session';
            sessionExplorerState.currentSessionId = session.sessionId || null;
            sessionExplorerState.currentSessionStartedAt = session.startedAt || null;
            sessionExplorerState.peers = peers;
            sessionExplorerState.timeline = timeline;
            sessionExplorerState.currentData = data;

            const identifiedUser = data.identifiedUser || {};
            const linkedUserLabel = identifiedUser.customerDisplayName || identifiedUser.emailPreview || (identifiedUser.customerId ? `Woo #${identifiedUser.customerId}` : '-');
            const linkedUserName = humanReadablePersonName(linkedUserLabel, 'Cliente');

            renderProfilePriorityBanner('session', {
                profile,
                metrics,
                patterns,
            });
            renderAttributionJourneyPanel();
            document.getElementById('session-detail-actions').innerHTML = renderActionCards(data.actionRecommendations || []);
            document.getElementById('session-detail-affinity').innerHTML = renderAffinityCards(
                data.commerceProfile?.topProducts || [],
                data.commerceProfile?.topPairings || []
            );

            document.getElementById('session-detail-title').textContent = `${profile.profileLabel || 'Historical profile'} · Session for ${linkedUserName}`;

            document.getElementById('session-detail-metrics').innerHTML = [
                { label: 'Eventos', value: metrics.totalEvents || 0 },
                { label: 'Logins', value: metrics.logins || 0 },
                { label: 'Page Views', value: metrics.pageViews || 0 },
                { label: 'View Item', value: metrics.viewItem || 0 },
                { label: 'Revenue', value: formatCurrency(metrics.revenue || 0) },
                { label: 'Pages unique', value: metrics.uniquePages || 0 },
                { label: 'Products unique', value: metrics.uniqueProducts || 0 },
                { label: 'Orders', value: metrics.orderCount || 0 },
            ].map((item) => `
                <div class="session-metric-card rounded-xl p-4">
                    <div class="text-xs uppercase tracking-wide text-gray-500">${item.label}</div>
                    <div class="session-metric-card-value mt-2 text-2xl font-semibold text-gray-900">${item.value}</div>
                </div>
            `).join('');

            document.getElementById('session-detail-summary').innerHTML = `
                <p><strong>Profile:</strong> ${profile.profileLabel || '-'}</p>
                <p><strong>Type:</strong> ${profile.profileType || '-'}</p>
                <p><strong>Connected user:</strong> ${linkedUserLabel}</p>
                <p><strong>Woo Customer ID:</strong> ${identifiedUser.customerId || '-'}</p>
                <p><strong>Identified email:</strong> ${identifiedUser.emailPreview || '-'}</p>
                <p><strong>User Key:</strong> ${session.userKey || '-'}</p>
                <p><strong>Start:</strong> ${formatDateTimeMx(session.startedAt)}</p>
                <p><strong>Latest event:</strong> ${formatDateTimeMx(session.lastEventAt)}</p>
                <p><strong>Session End:</strong> ${formatDateTimeMx(session.sessionEndAt || session.lastEventAt)}</p>
                <p><strong>Latest login:</strong> ${identifiedUser.lastLoginAt ? formatDateTimeMx(identifiedUser.lastLoginAt) : '-'}</p>
                <p><strong>Duration:</strong> ${formatDuration(session.sessionDurationSeconds || 0)}</p>
                <p><strong>Landing:</strong> ${session.landingPageUrl || '-'}</p>
                <p><strong>UTM:</strong> ${(session.utmSource || '-') + ' / ' + (session.utmCampaign || '-')}</p>
                <p><strong>GA4 Session Source:</strong> ${session.ga4SessionSource || '-'}</p>
                <p><strong>Referrer:</strong> ${session.referrer || '-'}</p>
                <p><strong>IP Hash:</strong> ${session.ipHash ? `${String(session.ipHash).slice(0, 10)}...` : '-'}</p>
                <p><strong>Funnel:</strong> PV ${metrics.pageViews || 0} · VI ${metrics.viewItem || 0} · ATC ${metrics.addToCart || 0} · BC ${metrics.beginCheckout || 0} · P ${metrics.purchase || 0}</p>
                <p><strong>Other sessions from the same user:</strong> ${patterns.peerSessionCount || 0}</p>
                <p><strong>Total stitched sessions:</strong> ${patterns.totalTrackedSessions || ((patterns.peerSessionCount || 0) + 1)}</p>
                <p><strong>Historical profile orders:</strong> ${profile.historicalOrderCount || 0}</p>
                <p><strong>Tracked UTM URLs:</strong> ${Number(utmHistory.totalUrls || 0)} across ${Number(utmHistory.sessionCount || 0)} sessions</p>
            `;

            document.getElementById('session-detail-attribution').innerHTML = `
                <p><strong>Channel:</strong> ${journey.attribution?.channel || 'unattributed'}</p>
                <p><strong>Platform:</strong> ${journey.attribution?.platform || '-'}</p>
                <p><strong>Campaign:</strong> ${journey.attribution?.campaign || '-'}</p>
                <p><strong>Click ID:</strong> ${journey.attribution?.clickId || '-'}</p>
                <p><strong>Confidence:</strong> ${formatPercent(journey.attribution?.confidence || 0)}</p>
                <p><strong>Source:</strong> ${journey.attribution?.source || 'none'}</p>
                <p><strong>Checkout Tokens:</strong> ${Array.isArray(journey.checkoutTokens) && journey.checkoutTokens.length ? journey.checkoutTokens.join(', ') : '-'}</p>
                <div>
                    <p class="font-medium text-gray-900 mb-1">Recognized UTM URL history</p>
                    ${renderTrackedUtmHistory(utmHistory)}
                </div>
            `;

            document.getElementById('session-detail-journey').innerHTML = `
                <div>
                    <p><strong>Entry:</strong> ${journey.entryPage || '-'}</p>
                    <p><strong>Exit:</strong> ${journey.exitPage || '-'}</p>
                </div>
                <div>
                    <p class="font-medium text-gray-900 mb-1">Highlighted pages</p>
                    ${pages.length
                        ? pages.map((page) => `<p class="text-xs text-gray-600 truncate">${page.url} · ${page.hits} hits</p>`).join('')
                        : '<p class="text-xs text-gray-500">No pages recorded.</p>'}
                </div>
                <div>
                    <p class="font-medium text-gray-900 mb-1">Touched products</p>
                    ${products.length
                        ? products.map((product) => `<p class="text-xs text-gray-600">${product.productId} · ${product.events} events</p>`).join('')
                        : '<p class="text-xs text-gray-500">No products recorded.</p>'}
                </div>
            `;

            document.getElementById('session-detail-visual').innerHTML = renderSessionVisual(patterns);
            document.getElementById('session-detail-patterns').innerHTML = renderSessionPatterns(patterns);
            renderPeerSessions(peers, session.sessionId || null, patterns);
            updatePeerNavigation(peers, session.sessionId || null);
            updateRecommendedComparison(patterns);
            renderSessionComparison();

            const displayOrders = orders.map((order) => ({
                ...order,
                attributedChannel: humanReadableChannel(order.attributedChannel || 'unattributed', order.attributedPlatform || ''),
            }));

            document.getElementById('session-detail-orders').innerHTML = displayOrders.length
                ? displayOrders.map((order, index) => `
                    <div class="session-order-card rounded-lg p-3">
                        <div class="flex items-start justify-between gap-3">
                            <div>
                                <p class="font-medium text-gray-900">Pedido ${index + 1} de ${escapeHtml(linkedUserName)}</p>
                                <p class="text-sm text-gray-500">${formatCurrencyWithCode(order.revenue || 0, order.currency || 'MXN')} · ${order.attributedChannel || 'unattributed'}</p>
                                <p class="text-xs text-gray-400">${formatDateTimeMx(order.platformCreatedAt || order.createdAt)}</p>
                            </div>
                            <span class="text-[11px] uppercase tracking-wide ${order.isCurrentSession ? 'session-positive-copy' : 'session-meta-copy'}">${order.isCurrentSession ? 'current session' : 'historical'}</span>
                        </div>
                    </div>
                `).join('')
                : '<p class="text-gray-500">No orders linked to this profile.</p>';

            renderSessionTimelineFromState();
        }

        function renderPeerSessions(peers, currentSessionId, patterns = {}) {
            const container = document.getElementById('session-peer-list');
            if (!container) return;
            const recommendedSessionId = patterns?.recommendedComparison?.sessionId || '';

            if (sessionExplorerState.mode === 'overview') {
                if (!Array.isArray(peers) || peers.length === 0) {
                    container.innerHTML = '<span class="text-sm text-gray-500">There are no historical profiles yet.</span>';
                    const note = document.getElementById('session-compare-recommended-note');
                    if (note) note.textContent = 'When profiles with activity appear, you will be able to open their most recent session from here.';
                    return;
                }

                container.innerHTML = peers.map((profile) => `
                    <button type="button" data-session-id="${profile.recentSessionId || ''}" class="session-peer-pill historical-profile-chip inline-flex items-center gap-2 px-3 py-2 rounded-full text-sm text-gray-700 ${profile.recentSessionId ? '' : 'opacity-60 cursor-not-allowed'}" ${profile.recentSessionId ? '' : 'disabled'}>
                        <span class="font-semibold">${profile.profileLabel || 'Historical profile'}</span>
                        <span class="text-xs text-gray-500">${profile.sessionCount || 0} sessions</span>
                        <span class="text-xs text-gray-400">${profile.orderCount || 0} orders</span>
                    </button>
                `).join('');

                container.querySelectorAll('.historical-profile-chip').forEach((button) => {
                    button.addEventListener('click', () => {
                        const sessionId = button.getAttribute('data-session-id');
                        if (sessionId) focusJourneyProfile({ sessionId });
                    });
                });

                const note = document.getElementById('session-compare-recommended-note');
                if (note) note.textContent = 'These chips are historical profiles. If one shows 0 sessions, Woo identified it through orders but the pixel has not linked web navigation to that customer yet.';
                return;
            }

            const currentChip = currentSessionId ? `
                <button type="button" class="session-peer-pill is-current inline-flex items-center gap-2 px-3 py-2 rounded-full text-sm shadow-sm">
                    <span>Actual</span>
                    <span class="font-semibold">${currentSessionId}</span>
                </button>
            ` : '';

            if (!Array.isArray(peers) || peers.length === 0) {
                container.innerHTML = currentChip || '<span class="text-sm text-gray-500">There are no other related sessions yet.</span>';
                return;
            }

            container.innerHTML = `${currentChip}${peers.map((peer) => {
                const badges = [];
                if (peer.flags?.viewedProduct) badges.push('PDP');
                if (peer.flags?.addedToCart) badges.push('ATC');
                if (peer.flags?.reachedCheckout) badges.push('CHK');
                if (peer.flags?.purchased) badges.push('BUY');
                if (peer.sessionId === recommendedSessionId) badges.unshift('Sugerida');
                return `
                    <div class="session-peer-pill inline-flex items-center gap-2 px-3 py-2 rounded-full text-sm text-gray-700">
                        <button type="button" data-session-id="${peer.sessionId}" class="session-peer-chip inline-flex items-center gap-2 hover:text-indigo-700">
                            <span class="font-semibold">${peer.sessionId}</span>
                            <span class="text-xs text-gray-500">${formatDateTimeMx(peer.startedAt)}</span>
                            <span class="text-xs text-gray-400">${badges.join(' · ') || 'Browsing'}</span>
                        </button>
                        <button type="button" data-compare-session-id="${peer.sessionId}" class="session-compare-pill session-compare-chip inline-flex items-center px-2 py-1 text-xs text-slate-700 hover:bg-slate-200">
                            Comparar
                        </button>
                    </div>
                `;
            }).join('')}`;

            container.querySelectorAll('.session-peer-chip').forEach((button) => {
                button.addEventListener('click', () => {
                    const sessionId = button.getAttribute('data-session-id');
                    if (sessionId) focusJourneyProfile({ sessionId });
                });
            });

            container.querySelectorAll('.session-compare-chip').forEach((button) => {
                button.addEventListener('click', async () => {
                    const sessionId = button.getAttribute('data-compare-session-id');
                    if (sessionId) await loadComparisonSession(sessionId, button);
                });
            });
        }

        function updateRecommendedComparison(patterns = {}) {
            const button = document.getElementById('session-compare-recommended');
            const note = document.getElementById('session-compare-recommended-note');
            const recommendation = patterns?.recommendedComparison || null;

            if (!button || !note) return;

            if (!recommendation?.sessionId) {
                button.classList.add('hidden');
                button.removeAttribute('data-session-id');
                note.textContent = patterns?.peerSessionCount
                    ? 'There is no clear recommended comparison yet; use the related sessions to review manually.'
                    : 'There are not enough related sessions yet to recommend a comparison.';
                return;
            }

            button.classList.remove('hidden');
            button.setAttribute('data-session-id', recommendation.sessionId);
            note.textContent = `${recommendation.headline || 'Suggested comparison'}: ${recommendation.reason || 'Open a related session with better analytical value.'}`;
        }

        function updatePeerNavigation(peers, currentSessionId) {
            const prevBtn = document.getElementById('session-peer-prev');
            const nextBtn = document.getElementById('session-peer-next');
            const ordered = Array.isArray(peers) ? peers.slice().sort((a, b) => new Date(a.startedAt || 0) - new Date(b.startedAt || 0)) : [];
            const withCurrent = currentSessionId ? [...ordered, { sessionId: currentSessionId, startedAt: sessionExplorerState.currentSessionStartedAt || null, isCurrent: true }] : ordered;
            withCurrent.sort((a, b) => new Date(a.startedAt || 0) - new Date(b.startedAt || 0));
            const index = withCurrent.findIndex((item) => item.sessionId === currentSessionId);
            const prev = index > 0 ? withCurrent[index - 1] : null;
            const next = index >= 0 && index < withCurrent.length - 1 ? withCurrent[index + 1] : null;

            if (prevBtn) {
                prevBtn.disabled = !prev || prev.isCurrent;
                prevBtn.dataset.targetSessionId = prev && !prev.isCurrent ? prev.sessionId : '';
            }
            if (nextBtn) {
                nextBtn.disabled = !next || next.isCurrent;
                nextBtn.dataset.targetSessionId = next && !next.isCurrent ? next.sessionId : '';
            }
        }

        function navigatePeerSession(direction) {
            const buttonId = direction < 0 ? 'session-peer-prev' : 'session-peer-next';
            const button = document.getElementById(buttonId);
            const sessionId = button?.dataset?.targetSessionId || '';
            if (sessionId) focusJourneyProfile({ sessionId });
        }

        function renderSessionTimelineFromState() {
            const container = document.getElementById('session-detail-timeline');
            const filterValue = document.getElementById('session-timeline-filter')?.value || 'all';
            if (!container) return;

            const formatSessionEventLabel = (event) => {
                if (event.bucket === 'login') return 'Login';
                if (event.eventName === 'add_to_cart') return 'Added to cart';
                if (event.eventName === 'begin_checkout') return 'Started checkout';
                if (event.eventName === 'view_item') return 'View item';
                if (event.eventName === 'page_view') return 'Page view';
                if (event.eventName === 'purchase') return 'Purchase';
                return event.eventName || '-';
            };

            const formatSessionEventDetail = (event) => {
                if (event.bucket === 'login') {
                    return event.customerName || event.customerEmail || event.customerId || 'Identified user';
                }
                return event.pageUrl || event.productId || event.orderId || '-';
            };

            const formatLayer6Meta = (event) => {
                const bits = [];
                if (event.rawSource) bits.push(`source=${event.rawSource}`);
                if (event.matchType) bits.push(`match=${event.matchType}`);
                if (typeof event.confidenceScore === 'number') bits.push(`confidence=${Math.round(event.confidenceScore * 100)}%`);
                if (event.collectedAt) bits.push(`collected=${formatTimeMx(event.collectedAt)}`);
                return bits.join(' | ');
            };

            const timeline = Array.isArray(sessionExplorerState.timeline) ? sessionExplorerState.timeline : [];
            const filteredTimeline = timeline.filter((event) => {
                if (filterValue === 'all') return true;
                if (filterValue === 'funnel') return ['page_view', 'view_item', 'add_to_cart', 'begin_checkout', 'purchase'].includes(event.bucket);
                if (filterValue === 'commerce') return ['view_item', 'add_to_cart', 'begin_checkout', 'purchase'].includes(event.bucket) || Boolean(event.productId || event.orderId || event.checkoutToken);
                if (filterValue === 'content') return event.bucket === 'page_view' || (!event.productId && !event.orderId && !event.checkoutToken);
                return true;
            });

            container.innerHTML = filteredTimeline.length
                ? filteredTimeline.map((event) => `
                    <div class="session-timeline-item rounded-lg p-3">
                        <div class="flex items-center justify-between gap-4">
                            <div>
                                <p class="font-medium text-gray-900">${formatSessionEventLabel(event)}</p>
                                <p class="text-xs text-gray-500">${formatSessionEventDetail(event)}</p>
                                <p class="text-[11px] !text-indigo-500 mt-1">${formatLayer6Meta(event) || '-'}</p>
                            </div>
                            <div class="text-right">
                                <p class="text-sm text-gray-700">${formatTimeMx(event.createdAt)}</p>
                                <p class="text-xs text-gray-400">${event.bucket || '-'}</p>
                            </div>
                        </div>
                    </div>
                `).join('')
                : '<p class="text-gray-500">There are no events for that filter.</p>';
        }

        async function fetchSessionDetailData(sessionId) {
            const res = await fetch(`/api/analytics/${currentShopId}/sessions/${encodeURIComponent(sessionId)}`);
            if (!res.ok) throw new Error('Could not load the session');
            const data = await res.json();
            console.debug('[Session Explorer] raw session detail payload', {
                sessionId,
                profile: data?.profile || null,
                peerCount: Array.isArray(data?.peers) ? data.peers.length : 0,
                orderCount: Array.isArray(data?.orders) ? data.orders.length : 0,
            });
            return data;
        }

        async function loadComparisonSession(sessionId, triggerButton = null) {
            if (!sessionId) return;

            try {
                triggerButton?.setAttribute('disabled', 'true');
                const compareData = await fetchSessionDetailData(sessionId);
                sessionExplorerState.compareData = compareData;
                renderSessionComparison();
            } catch (_) {
                sessionExplorerState.compareData = null;
                renderSessionComparison('Could not load the comparison session.');
            } finally {
                triggerButton?.removeAttribute('disabled');
            }
        }

        function clearSessionComparison() {
            sessionExplorerState.compareData = null;
            renderSessionComparison();
        }

        function renderSessionComparison(errorMessage = '') {
            const panel = document.getElementById('session-compare-panel');
            const title = document.getElementById('session-compare-title');
            const content = document.getElementById('session-compare-content');
            if (!panel || !title || !content) return;

            const currentData = sessionExplorerState.currentData;
            const compareData = sessionExplorerState.compareData;

            if (errorMessage) {
                panel.classList.remove('hidden');
                title.textContent = errorMessage;
                content.innerHTML = '<p class="text-sm text-red-600">Could not build the comparison.</p>';
                return;
            }

            if (!currentData || !compareData) {
                panel.classList.add('hidden');
                title.textContent = 'Select a related session to compare.';
                content.innerHTML = '';
                return;
            }

            panel.classList.remove('hidden');
                title.textContent = `Current ${currentData.session?.sessionId || '-'} vs ${compareData.session?.sessionId || '-'}`;

            const currentMetrics = currentData.metrics || {};
            const compareMetrics = compareData.metrics || {};
            const metricRows = [
                { label: 'Events', current: Number(currentMetrics.totalEvents || 0), compare: Number(compareMetrics.totalEvents || 0) },
                { label: 'Duration', current: Number(currentData.session?.sessionDurationSeconds || 0), compare: Number(compareData.session?.sessionDurationSeconds || 0), formatter: formatDuration },
                { label: 'View Item', current: Number(currentMetrics.viewItem || 0), compare: Number(compareMetrics.viewItem || 0) },
                { label: 'Add To Cart', current: Number(currentMetrics.addToCart || 0), compare: Number(compareMetrics.addToCart || 0) },
                { label: 'Checkout', current: Number(currentMetrics.beginCheckout || 0), compare: Number(compareMetrics.beginCheckout || 0) },
                { label: 'Purchase', current: Number(currentMetrics.purchase || 0), compare: Number(compareMetrics.purchase || 0) },
            ];

            const cardsHtml = `
                <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    ${metricRows.map((row) => {
                        const currentValue = row.formatter ? row.formatter(row.current) : row.current;
                        const compareValue = row.formatter ? row.formatter(row.compare) : row.compare;
                        const delta = row.current - row.compare;
                        const deltaText = delta === 0 ? 'igual' : delta > 0 ? `+${delta}` : `${delta}`;
                        return `
                            <div class="session-metric-card rounded-xl p-4">
                                <p class="text-xs uppercase tracking-wide text-gray-500">${row.label}</p>
                                <div class="mt-2 flex items-end justify-between gap-4">
                                    <div>
                                        <p class="text-lg font-semibold text-gray-900">${currentValue}</p>
                                        <p class="text-xs text-gray-500">Current</p>
                                    </div>
                                    <div class="text-right">
                                        <p class="text-lg font-semibold text-slate-600">${compareValue}</p>
                                        <p class="text-xs text-gray-500">Compared</p>
                                    </div>
                                </div>
                                <p class="mt-2 text-xs ${delta > 0 ? 'session-positive-copy' : delta < 0 ? 'session-warning-copy' : 'session-meta-copy'}">Delta: ${deltaText}</p>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;

            const funnelHtml = renderComparisonFunnel(currentData, compareData);
            const insightHtml = renderComparisonInsights(currentData, compareData);

            content.innerHTML = `${cardsHtml}<div class="grid grid-cols-1 xl:grid-cols-2 gap-4">${funnelHtml}${insightHtml}</div>`;
        }

        function renderComparisonFunnel(currentData, compareData) {
            const currentMetrics = currentData.metrics || {};
            const compareMetrics = compareData.metrics || {};
            const steps = [
                { label: 'PV', current: Number(currentMetrics.pageViews || 0), compare: Number(compareMetrics.pageViews || 0) },
                { label: 'VI', current: Number(currentMetrics.viewItem || 0), compare: Number(compareMetrics.viewItem || 0) },
                { label: 'ATC', current: Number(currentMetrics.addToCart || 0), compare: Number(compareMetrics.addToCart || 0) },
                { label: 'BC', current: Number(currentMetrics.beginCheckout || 0), compare: Number(compareMetrics.beginCheckout || 0) },
                { label: 'P', current: Number(currentMetrics.purchase || 0), compare: Number(compareMetrics.purchase || 0) },
            ];

            return `
                <div class="session-summary-card rounded-xl p-4">
                    <p class="text-sm font-semibold text-gray-900 mb-3">Compared funnel</p>
                    <div class="space-y-3">
                        ${steps.map((step) => {
                            const maxValue = Math.max(step.current, step.compare, 1);
                            return `
                                <div>
                                    <div class="flex items-center justify-between text-xs text-gray-600 mb-1">
                                        <span>${step.label}</span>
                                        <span>Current ${step.current} / Compared ${step.compare}</span>
                                    </div>
                                    <div class="space-y-1">
                                        <div class="pattern-rate-bar h-2 rounded-full overflow-hidden"><span class="session-compare-current-bar block h-full" style="width:${Math.round((step.current / maxValue) * 100)}%"></span></div>
                                        <div class="pattern-rate-bar h-2 rounded-full overflow-hidden"><span class="session-compare-peer-bar block h-full" style="width:${Math.round((step.compare / maxValue) * 100)}%"></span></div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        }

        function renderComparisonInsights(currentData, compareData) {
            const currentMetrics = currentData.metrics || {};
            const compareMetrics = compareData.metrics || {};
            const insights = [];

            if (Number(currentMetrics.beginCheckout || 0) > Number(compareMetrics.beginCheckout || 0)) {
                insights.push('The current session pushes toward checkout more than the compared one.');
            }
            if (Number(currentMetrics.purchase || 0) < Number(compareMetrics.purchase || 0)) {
                insights.push('The compared session converts better at the end of the funnel.');
            }
            if (Number(currentMetrics.viewItem || 0) > Number(compareMetrics.viewItem || 0) && Number(currentMetrics.addToCart || 0) === 0) {
                insights.push('The current session explores more products, but does not turn that exploration into intent.');
            }
            if (Number(currentData.session?.sessionDurationSeconds || 0) > Number(compareData.session?.sessionDurationSeconds || 0)) {
                insights.push('The current session lasts longer; it is worth checking whether that means more interest or more friction.');
            }
            if (!insights.length) {
                insights.push('Both sessions behave similarly; there is no strong deviation in the journey.');
            }

            return `
                <div class="session-summary-card rounded-xl p-4">
                    <p class="text-sm font-semibold text-gray-900 mb-3">Quick read</p>
                    <div class="space-y-2 text-sm text-gray-700">
                        ${insights.map((item) => `<p>${item}</p>`).join('')}
                    </div>
                </div>
            `;
        }

        function renderSessionVisual(patterns) {
            const path = Array.isArray(patterns.currentPath) ? patterns.currentPath : [];
            const comparison = Array.isArray(patterns.stageComparison) ? patterns.stageComparison : [];

            const flowHtml = path.length
                ? `<div class="flex flex-wrap gap-6 items-start">${path.map((step) => `
                    <div class="session-flow-step">
                        <div class="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-lg">
                            <span class="text-sm font-semibold">${step.label.slice(0, 2).toUpperCase()}</span>
                        </div>
                        <p class="mt-2 text-sm font-semibold text-gray-900">${step.label}</p>
                    </div>
                `).join('')}</div>`
                : '<p class="text-sm text-gray-500">There are not enough steps to draw the journey.</p>';

            const barsHtml = comparison.length
                ? `<div class="space-y-3 mt-5">${comparison.map((item) => `
                    <div>
                        <div class="flex items-center justify-between text-xs text-gray-600 mb-1">
                            <span>${item.label}</span>
                            <span>${Math.round(Number(item.peerRate || 0) * 100)}% in other sessions</span>
                        </div>
                        <div class="pattern-rate-bar h-2 rounded-full bg-gray-200 overflow-hidden">
                            <span class="block h-full ${item.current ? 'bg-emerald-500' : 'bg-amber-400'}" style="width:${Math.max(4, Math.round(Number(item.peerRate || 0) * 100))}%"></span>
                        </div>
                    </div>
                `).join('')}</div>`
                : '';

            return `${flowHtml}${barsHtml}`;
        }

        function renderSessionPatterns(patterns) {
            const cards = Array.isArray(patterns.patternCards) ? patterns.patternCards : [];
            const longitudinalCards = Array.isArray(patterns.longitudinalCards) ? patterns.longitudinalCards : [];
            const topLandingPages = Array.isArray(patterns.topLandingPages) ? patterns.topLandingPages : [];
            const topCampaigns = Array.isArray(patterns.topCampaigns) ? patterns.topCampaigns : [];

            const cardsHtml = cards.length
                ? cards.map((card) => `
                    <div class="session-pattern-item rounded-xl p-4">
                        <p class="text-sm font-semibold text-gray-900">${card.title || '-'}</p>
                        <p class="mt-1 text-sm text-gray-600">${card.detail || '-'}</p>
                        <p class="session-positive-copy mt-2 text-xs font-medium uppercase tracking-wide">Suggested application</p>
                        <p class="session-positive-copy text-sm">${card.action || '-'}</p>
                    </div>
                `).join('')
                : '<p class="text-sm text-gray-500">There are not enough patterns yet.</p>';

            const longitudinalHtml = longitudinalCards.length
                ? `
                    <div>
                        <p class="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Longitudinal read</p>
                        <div class="space-y-3">
                            ${longitudinalCards.map((card) => `
                                <div class="session-side-card rounded-xl p-4">
                                    <p class="text-sm font-semibold text-gray-900">${card.title || '-'}</p>
                                    <p class="mt-1 text-sm text-gray-600">${card.detail || '-'}</p>
                                    <p class="session-accent-copy mt-2 text-xs font-medium uppercase tracking-wide">How to use it</p>
                                    <p class="session-accent-copy text-sm">${card.action || '-'}</p>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `
                : '';

            const sideNotes = `
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div class="session-side-card rounded-xl p-4">
                        <p class="text-xs font-semibold uppercase tracking-wide text-gray-500">Recurring landings</p>
                        <div class="mt-2 space-y-1 text-sm text-gray-600">
                            ${topLandingPages.length
                                ? topLandingPages.map((item) => `<p class="truncate">${item.url} · ${item.sessions} sessions</p>`).join('')
                                : '<p>Not enough history yet.</p>'}
                        </div>
                    </div>
                    <div class="session-side-card rounded-xl p-4">
                        <p class="text-xs font-semibold uppercase tracking-wide text-gray-500">Frequent campaigns</p>
                        <div class="mt-2 space-y-1 text-sm text-gray-600">
                            ${topCampaigns.length
                                ? topCampaigns.map((item) => `<p>${item.campaign} · ${item.sessions} sessions</p>`).join('')
                                : '<p>No dominant campaign.</p>'}
                        </div>
                    </div>
                </div>
                <div class="text-xs text-gray-500">
                    Average across other sessions: ${patterns.avgEvents || 0} events · ${formatDuration(patterns.avgDurationSeconds || 0)}${patterns.averageGapHours ? ` · average gap ${patterns.averageGapHours}h` : ''}
                </div>
            `;

            return `${cardsHtml}${longitudinalHtml}${sideNotes}`;
        }

        // --- FETCH ANALYTICS ---
        async function fetchAnalytics() {
            if (!currentShopId) {
                logAnalyticsDebug('fetchAnalytics skipped because currentShopId is empty', {
                    currentShopId,
                    urlShop: getShopIdFromUrl(),
                    storedShop: readStoredShopId(),
                    authorizedShops: authorizedShopOptions.map((item) => item.shop),
                });
                return;
            }
            if (analyticsFetchInFlight) return;
            analyticsFetchInFlight = true;
            const initialLoad = !hasRenderedInitialAnalytics;

            try {
                setAnalyticsLoadingState(true, {
                    mode: initialLoad ? 'boot' : 'refresh',
                    title: initialLoad ? 'Loading attribution data' : 'Refreshing analytics',
                    copy: initialLoad
                        ? `Fetching metrics, journeys, and live signals for ${currentShopId}.`
                        : `Updating the latest analytics for ${currentShopId}.`,
                });

                const modelSelect = document.getElementById('attribution-model');
                if (modelSelect) {
                    currentAttributionModel = modelSelect.value || 'last_touch';
                }

                const preset = document.getElementById('date-preset')?.value || '30d';
                const allTime = preset === 'all';
                const startValue = document.getElementById('start-date')?.value || '';
                const endValue = document.getElementById('end-date')?.value || '';
                const historyLimit = document.getElementById('history-limit')?.value || 'all';
                
                const queryParams = new URLSearchParams();
                queryParams.set('attribution_model', currentAttributionModel);
                queryParams.set('recent_limit', historyLimit);

                if (allTime) {
                    queryParams.set('all_time', '1');
                } else {
                    const start = startValue ? new Date(`${startValue}T00:00:00`) : new Date();
                    const end = endValue ? new Date(`${endValue}T23:59:59`) : new Date();
                    queryParams.set('start', start.toISOString());
                    queryParams.set('end', end.toISOString());
                }

                const query = `?${queryParams.toString()}`;
                logAnalyticsDebug('fetchAnalytics request', {
                    currentShopId,
                    query,
                });
                const res = await fetch(`/api/analytics/${currentShopId}${query}`);
                
                if (!res.ok) throw new Error('Failed to fetch analytics');
                
                const data = await res.json();
                renderDashboard(data);
                markAnalyticsReady();
                fetchJourneyWooProfiles()
                    .then(() => {
                        renderAttributionJourneyPanel();
                    })
                    .catch((error) => {
                        console.warn('[Journey] Background profile refresh failed', error);
                    });

            } catch (error) {
                console.error('Analytics error:', error);
                setAnalyticsLoadingState(false);
                alert('Error loading analytics data');
            } finally {
                analyticsFetchInFlight = false;
            }
        }

        // --- RENDER DASHBOARD ---
        function renderDashboard(data) {
            // Metrics (Fix: match API structure)
            const summary = data.summary || { totalRevenue: 0, totalOrders: 0 };
            if (currentShopId && summary?.storePlatform) updateShopHeader(currentShopId, summary.storePlatform);
            const pixelHealth = data.pixelHealth || {};
            const dataQuality = data.dataQuality || {};
            const integrationHealth = data.integrationHealth || {};
            const paidMedia = data.paidMedia || {};
            updateDateRangeLabel(summary);
            document.getElementById('total-revenue').textContent = formatCurrency(summary.totalRevenue);
            document.getElementById('total-orders').textContent = summary.totalOrders;
              document.getElementById('attributed-orders').textContent = summary.attributedOrders;
            document.getElementById('total-sessions').textContent = (summary.totalSessions || 0).toLocaleString();
            document.getElementById('conversion-rate').textContent = formatPercent(summary.conversionRate || 0);
            document.getElementById('page-views').textContent = (summary.pageViews || 0).toLocaleString();
            document.getElementById('view-item').textContent = (summary.viewItem || 0).toLocaleString();
            document.getElementById('add-to-cart').textContent = (summary.addToCart || 0).toLocaleString();
            document.getElementById('begin-checkout').textContent = (summary.beginCheckout || 0).toLocaleString();
            document.getElementById('purchase-events').textContent = (summary.purchaseEvents || 0).toLocaleString();
            document.getElementById('unattributed-orders').textContent = (summary.unattributedOrders || 0).toLocaleString();
            document.getElementById('unattributed-revenue').textContent = formatCurrency(summary.unattributedRevenue || 0);
            
            // Render Marketing Cards
            if (document.getElementById('meta-roas')) {
                document.getElementById('meta-roas').textContent = formatRoas(paidMedia?.meta?.roas);
                document.getElementById('meta-spend').textContent = formatCurrency(paidMedia?.meta?.spend || 0);
            }
            if (document.getElementById('google-roas')) {
                document.getElementById('google-roas').textContent = formatRoas(paidMedia?.google?.roas);
                document.getElementById('google-spend').textContent = formatCurrency(paidMedia?.google?.spend || 0);
            }
            if (document.getElementById('tiktok-roas')) {
                document.getElementById('tiktok-roas').textContent = formatRoas(paidMedia?.tiktok?.roas); // Not currently returned but ready
                document.getElementById('tiktok-spend').textContent = formatCurrency(paidMedia?.tiktok?.spend || 0);
            }

            
            
            
            renderIntegrationHealth(integrationHealth);
            renderPaidMedia(paidMedia);

            const modelBadge = document.getElementById('attribution-model-badge');
            if (modelBadge) {
                const model = summary.attributionModel || currentAttributionModel || 'last_touch';
                const modelDisplay = {
                    'last_touch': 'LastClick',
                    'first_touch': 'FirstClick',
                    'linear': 'Linear',
                    'meta': 'Meta',
                    'google_ads': 'GoogleAds'
                }[model] || model.replace('_', ' ');
                modelBadge.textContent = `Model: ${modelDisplay}`;
            }

            
            
            
            
            
            
            // Channel Metrics (Fix: API returns object, map to array)
            const channels = data.channels || {};

            // Transform for chart
            const attributionData = Object.entries(channels).map(([key, val]) => ({
                channel: key,
                revenue: val.revenue,
                orders: val.orders
            })).filter(d => d.revenue > 0);

            // Charts
            renderAttributionChart(attributionData, paidMedia);
            renderAttributionPieChart(attributionData);
            renderTopProducts(data.topProducts || []);
            renderRecentPurchases(data.recentPurchases || []);
            renderDataEnrichment(data.recentPurchases || []);
            renderAttributionJourneyPanel();
        }

        function renderTopProducts(products) {
            const container = document.getElementById('top-products-list');
            if (!container) return;

            if (!Array.isArray(products) || products.length === 0) {
                container.innerHTML = '<p class="text-sm text-gray-400">No product data yet.</p>';
                return;
            }

            container.innerHTML = products.slice(0, 10).map((p, idx) => {
                const name = p.name || p.title || p.id || 'Unnamed product';
                const units = Number(p.units || 0);
                const revenue = Number(p.revenue || 0);
                return `
                    <div class="flex items-center justify-between border border-gray-100 rounded-lg p-3">
                        <div>
                            <p class="text-sm font-semibold text-gray-900">#${idx + 1} ${name}</p>
                            <p class="text-xs text-gray-500">Units: ${units.toLocaleString()}</p>
                        </div>
                        <p class="text-sm font-bold text-indigo-600">${formatCurrency(revenue)}</p>
                    </div>
                `;
            }).join('');
        }

        function renderIntegrationHealth(integrationHealth) {
            const platforms = ['meta', 'google', 'tiktok'];
            let anyActive = false;
            const activePlatforms = [];

            platforms.forEach((platform) => {
                const statusEl = document.getElementById(`ih-${platform}-status`);
                const updatedEl = document.getElementById(`ih-${platform}-updated`);
                if (!statusEl || !updatedEl) return;
                const state = integrationHealth?.[platform] || {};
                const status = String(state.status || 'DISCONNECTED').toUpperCase();
                
                if (status === 'ACTIVE') {
                    anyActive = true;
                    activePlatforms.push(platform);
                }

                statusEl.textContent = status === 'ACTIVE' ? 'ACTIVE' : status;
                updatedEl.textContent = state.updatedAt ? `Updated: ${formatDateTimeMx(state.updatedAt)}` : 'No connection recorded';
            });

            // Update Data Enrichment Trigger Badge
        }

            // Populate Modal specific features
        let globalPaidMediaCampaigns = [];
        const paidMediaSelectorState = {
            meta: { loading: false, loaded: false, accounts: [], defaultId: null },
            google: { loading: false, loaded: false, accounts: [], defaultId: null },
        };

        function normalizePaidMediaAccountId(platform, value) {
            const raw = String(value || '').trim();
            if (!raw) return '';
            if (platform === 'meta') return raw.replace(/^act_/, '');
            if (platform === 'google') return raw.replace(/^customers\//, '').replace(/[^\d]/g, '');
            return raw;
        }

        function getPaidMediaAccountsEndpoint(platform) {
            return platform === 'meta' ? '/api/meta/insights/accounts' : '/api/google/ads/insights/accounts';
        }

        function getPaidMediaSelectionEndpoint(platform) {
            return platform === 'meta' ? '/api/meta/insights/accounts/selection' : '/api/google/ads/insights/accounts/selection';
        }

        function formatConnectedAccountLabel(sourceState) {
            const accountId = sourceState?.connectedResourceId || '';
            const accountName = sourceState?.connectedResourceName || '';
            if (accountName && accountId) return `${accountName} (${accountId})`;
            if (accountName) return accountName;
            if (accountId) return accountId;
            return 'No seleccionada';
        }

        function formatActiveCampaignLabel(sourceState) {
            const campaignName = sourceState?.activeCampaignName || sourceState?.campaigns?.[0]?.name || sourceState?.campaigns?.[0]?.campaign_name || '';
            const campaignId = sourceState?.activeCampaignId || sourceState?.campaigns?.[0]?.id || sourceState?.campaigns?.[0]?.campaign_id || '';
            if (campaignName && campaignId) return `${campaignName} (${campaignId})`;
            if (campaignName) return campaignName;
            if (campaignId) return campaignId;
            return 'No dominant campaign';
        }

        function normalizePaidMediaCampaignLookupValue(value = '') {
            return String(value || '')
                .trim()
                .toLowerCase()
                .replace(/^act_/, '')
                .replace(/[^\w.-]+/g, '');
        }

        function isOpaqueAttributionIdentifier(value = '') {
            const raw = String(value || '').trim();
            if (!raw) return false;
            const compact = raw.replace(/[^\da-z]/gi, '');
            if (/^\d{8,}$/.test(raw)) return true;
            if (/^[a-f0-9]{16,}$/i.test(compact)) return true;
            return false;
        }

        function sanitizeAttributionLabel(value = '') {
            const raw = String(value || '').trim();
            if (!raw) return '';
            if (['-', 'n/a', 'na', 'none', 'null', 'undefined', 'unknown', 'not set'].includes(raw.toLowerCase())) {
                return '';
            }
            return raw;
        }

        function findPaidMediaCampaignMatch({ channel = '', platform = '', campaign = '', adset = '', ad = '' } = {}) {
            const platformKey = normalizeAttributionChannel(channel || platform || '', platform || channel || '');
            if (platformKey !== 'meta' && platformKey !== 'google' && platformKey !== 'tiktok') return null;

            const rows = Array.isArray(globalPaidMediaCampaigns)
                ? globalPaidMediaCampaigns.filter((row) => String(row?._platform || '').trim().toLowerCase() === platformKey)
                : [];
            if (!rows.length) return null;

            const candidates = [campaign, adset, ad]
                .map((value) => String(value || '').trim())
                .filter(Boolean);
            if (!candidates.length) return null;

            const normalizedCandidates = new Set(candidates.map((value) => normalizePaidMediaCampaignLookupValue(value)).filter(Boolean));
            if (!normalizedCandidates.size) return null;

            return rows.find((row) => {
                const rowId = normalizePaidMediaCampaignLookupValue(row?.id || row?.campaign_id || '');
                const rowName = normalizePaidMediaCampaignLookupValue(row?.name || row?.campaign_name || '');
                return (rowId && normalizedCandidates.has(rowId)) || (rowName && normalizedCandidates.has(rowName));
            }) || null;
        }

        function resolveAttributedSourceDescriptor(purchase = {}) {
            const channel = purchase?.attributedChannel || '';
            const platform = purchase?.attributedPlatform || '';
            const rawCampaign = String(purchase?.attributedCampaign || purchase?.attributionDebug?.payloadUtmCampaign || '').trim();
            const rawAdset = String(purchase?.attributedAdset || '').trim();
            const rawAd = String(purchase?.attributedAd || '').trim();
            const rawCampaignLabel = sanitizeAttributionLabel(purchase?.attributedCampaignLabel || '');
            const rawAdsetLabel = sanitizeAttributionLabel(purchase?.attributedAdsetLabel || '');
            const rawAdLabel = sanitizeAttributionLabel(purchase?.attributedAdLabel || '');

            const typedCandidates = [
                { type: 'ad', label: rawAdLabel || (!isOpaqueAttributionIdentifier(rawAd) ? sanitizeAttributionLabel(rawAd) : '') },
                { type: 'adset', label: rawAdsetLabel || (!isOpaqueAttributionIdentifier(rawAdset) ? sanitizeAttributionLabel(rawAdset) : '') },
                { type: 'campaign', label: rawCampaignLabel || (!isOpaqueAttributionIdentifier(rawCampaign) ? sanitizeAttributionLabel(rawCampaign) : '') },
            ].filter((entry) => entry.label);

            const matchedCampaign = findPaidMediaCampaignMatch({
                channel,
                platform,
                campaign: rawCampaignLabel || rawCampaign,
                adset: rawAdsetLabel || rawAdset,
                ad: rawAdLabel || rawAd,
            });

            if (typedCandidates[0]) {
                const readableDirect = typedCandidates[0];
                if (matchedCampaign?.name) {
                    const directNormalized = normalizePaidMediaCampaignLookupValue(readableDirect.label);
                    const matchedNormalized = normalizePaidMediaCampaignLookupValue(matchedCampaign.name || '');
                    if (matchedNormalized && directNormalized !== matchedNormalized) {
                        return {
                            type: readableDirect.type,
                            label: `${readableDirect.label} · ${matchedCampaign.name}`,
                        };
                    }
                }
                return readableDirect;
            }

            if (matchedCampaign?.name) return { type: 'campaign', label: String(matchedCampaign.name).trim() };
            if (rawCampaignLabel) return { type: 'campaign', label: rawCampaignLabel };
            if (rawAdsetLabel) return { type: 'adset', label: rawAdsetLabel };
            if (rawAdLabel) return { type: 'ad', label: rawAdLabel };
            if (rawCampaign) return { type: 'campaign', label: rawCampaign };
            if (rawAdset) return { type: 'adset', label: rawAdset };
            if (rawAd) return { type: 'ad', label: rawAd };
            return { type: 'campaign', label: 'No campaign' };
        }

        function resolveAttributedCampaignLabel(purchase = {}) {
            return resolveAttributedSourceDescriptor(purchase).label || 'No campaign';
        }

        function humanReadableAttributionLabelType(type = '') {
            const normalized = String(type || '').trim().toLowerCase();
            if (normalized === 'ad') return 'ad';
            if (normalized === 'adset') return 'ad set';
            return 'campaign';
        }

        async function ensurePaidMediaSelector(platform, sourceState) {
            const state = paidMediaSelectorState[platform];
            if (!state) return;

            const selectEl = document.getElementById(`pm-${platform}-account-select`);
            const feedbackEl = document.getElementById(`pm-${platform}-account-feedback`);
            if (!selectEl) return;

            if (!state.loaded && !state.loading) {
                state.loading = true;
                try {
                    const res = await fetch(`${getPaidMediaAccountsEndpoint(platform)}?all=1`);
                    const body = await res.json().catch(() => ({}));
                    const accounts = Array.isArray(body?.accounts) ? body.accounts : [];

                    state.accounts = accounts.map((acc) => ({
                        id: normalizePaidMediaAccountId(platform, acc?.id),
                        name: String(acc?.name || acc?.descriptiveName || acc?.descriptive_name || acc?.id || '').trim(),
                    })).filter((acc) => acc.id);

                    state.defaultId = normalizePaidMediaAccountId(platform, body?.defaultAccountId || body?.defaultCustomerId || '');
                    state.loaded = true;
                } catch (err) {
                    console.warn(`[PaidMedia UI] Failed to load ${platform} accounts`, err);
                    state.accounts = [];
                    state.defaultId = '';
                    state.loaded = true;
                } finally {
                    state.loading = false;
                }
            }

            const currentId = normalizePaidMediaAccountId(platform, sourceState?.connectedResourceId || '');
            const selectedValue = currentId || state.defaultId || '';

            const optionsHtml = state.accounts.length
                ? state.accounts.map((acc) => `<option value="${acc.id}">${acc.name || acc.id}</option>`).join('')
                : '<option value="">No accounts available</option>';

            selectEl.innerHTML = optionsHtml;
            selectEl.disabled = state.accounts.length === 0;
            if (selectedValue) selectEl.value = selectedValue;
            if (feedbackEl) {
                feedbackEl.textContent = state.accounts.length
                    ? ''
                    : 'No accounts available to select.';
            }
        }

        async function applyPaidMediaAccountSelection(platform) {
            const selectEl = document.getElementById(`pm-${platform}-account-select`);
            const feedbackEl = document.getElementById(`pm-${platform}-account-feedback`);
            const applyBtn = document.getElementById(`pm-${platform}-account-apply`);
            if (!selectEl || !selectEl.value) return;

            try {
                if (applyBtn) applyBtn.disabled = true;
                if (feedbackEl) feedbackEl.textContent = 'Applying selection...';

                const selectedId = normalizePaidMediaAccountId(platform, selectEl.value);
                const res = await fetch(getPaidMediaSelectionEndpoint(platform), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ accountIds: [selectedId] }),
                });

                const body = await res.json().catch(() => ({}));
                if (!res.ok || body?.ok === false) {
                    throw new Error(body?.error || `Could not update ${platform}`);
                }

                if (feedbackEl) feedbackEl.textContent = 'Selection applied. Refreshing metrics...';
                await fetchAnalytics();
            } catch (err) {
                console.error(`[PaidMedia UI] Selection update failed for ${platform}`, err);
                if (feedbackEl) feedbackEl.textContent = `Update error: ${err?.message || err}`;
            } finally {
                if (applyBtn) applyBtn.disabled = false;
            }
        }

        function renderPaidMedia(paidMedia) {
            const linkStatus = document.getElementById('pm-link-status');

            if (linkStatus) {
                if (paidMedia?.available) linkStatus.textContent = 'API active';
                else if (paidMedia?.linked) linkStatus.textContent = 'Connected without data';
                else linkStatus.textContent = 'Not connected';
            }

            renderPaidMediaSource('meta', paidMedia?.meta || {});
            renderPaidMediaSource('google', paidMedia?.google || {});

            const metaApplyBtn = document.getElementById('pm-meta-account-apply');
            if (metaApplyBtn && !metaApplyBtn.dataset.bound) {
                metaApplyBtn.addEventListener('click', () => applyPaidMediaAccountSelection('meta'));
                metaApplyBtn.dataset.bound = '1';
            }

            const googleApplyBtn = document.getElementById('pm-google-account-apply');
            if (googleApplyBtn && !googleApplyBtn.dataset.bound) {
                googleApplyBtn.addEventListener('click', () => applyPaidMediaAccountSelection('google'));
                googleApplyBtn.dataset.bound = '1';
            }

            void ensurePaidMediaSelector('meta', paidMedia?.meta || {});
            void ensurePaidMediaSelector('google', paidMedia?.google || {});

            let unified = [];
            const metaCamps = paidMedia?.meta?.campaigns || [];
            const googleCamps = paidMedia?.google?.campaigns || [];

            metaCamps.forEach((c) => {
                c._platform = 'meta';
                c._currency = paidMedia?.meta?.currency || 'MXN';
                unified.push(c);
            });
            googleCamps.forEach((c) => {
                c._platform = 'google';
                c._currency = paidMedia?.google?.currency || 'MXN';
                unified.push(c);
            });

            globalPaidMediaCampaigns = unified;
            renderUnifiedCampaigns();
        }

        function renderPaidMediaSource(prefix, sourceState) {
            const statusEl = document.getElementById(`pm-${prefix}-status`);
            const spendEl = document.getElementById(`pm-${prefix}-spend`);
            const revenueEl = document.getElementById(`pm-${prefix}-revenue`);
            const roasEl = document.getElementById(`pm-${prefix}-roas`);
            const syncEl = document.getElementById(`pm-${prefix}-sync`);
            const accountEl = document.getElementById(`pm-${prefix}-account`);
            const campaignEl = document.getElementById(`pm-${prefix}-campaign`);
            if (!statusEl || !spendEl || !revenueEl || !roasEl || !syncEl) return;

            const currency = sourceState?.currency || 'MXN';
            let statusLabel = 'Disconnected';
            if (sourceState?.connected && sourceState?.ready) statusLabel = 'API active';
            else if (sourceState?.connected) statusLabel = 'Connected';

            statusEl.textContent = statusLabel;
            spendEl.textContent = formatCurrencyWithCode(sourceState?.spend || 0, currency);
            revenueEl.textContent = formatCurrencyWithCode(sourceState?.revenue || 0, currency);
            roasEl.textContent = formatRoas(sourceState?.roas);
            if (accountEl) accountEl.textContent = formatConnectedAccountLabel(sourceState);
            if (campaignEl) campaignEl.textContent = formatActiveCampaignLabel(sourceState);

            if (sourceState?.connected && sourceState?.ready) {
                if (sourceState?.rangeUsed?.fallbackUsed) {
                    syncEl.textContent = `Fallback ${sourceState?.rangeUsed?.since || ''} to ${sourceState?.rangeUsed?.until || ''}`;
                } else {
                    syncEl.textContent = '';
                }
            } else if (sourceState?.connected) {
                syncEl.textContent = 'Connected, waiting for API response';
            } else {
                syncEl.textContent = 'Not connected';
            }
        }

        function renderUnifiedCampaigns() {
            const container = document.getElementById('pm-campaigns-container');
            const tbody = document.getElementById('pm-campaigns-tbody');
            const filterValue = document.getElementById('pm-campaign-filter')?.value || 'all';

            if (!container || !tbody) return;

            let filteredCamps = globalPaidMediaCampaigns;
            if (filterValue !== 'all') {
                filteredCamps = filteredCamps.filter(c => c._platform === filterValue);
            }

            if (!filteredCamps || filteredCamps.length === 0) {
                container.classList.add('hidden');
                return;
            }

            // Descending order by spend
            const sortedCamps = filteredCamps
                .sort((a, b) => (b.kpis?.spend || b.cost || 0) - (a.kpis?.spend || a.cost || 0))
                .slice(0, 50);

            tbody.innerHTML = sortedCamps.map(c => {
                const name = c.campaign_name || c.name || 'Desconocida';
                const currency = c._currency;
                const spend = c.kpis?.spend ?? c.cost ?? 0;
                const rev = c.kpis?.purchase_value ?? c.kpis?.conversion_value ?? c.conv_value ?? 0;
                const roas = c.kpis?.roas ?? c.roas ?? 0;
                const cpa = c.kpis?.cpa ?? c.cpa ?? c.cpp ?? 0;

                const platformBadge = c._platform === 'meta' 
                    ? `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium" style="background: rgba(124, 168, 255, 0.15); color: #7ca8ff; border: 1px solid rgba(124, 168, 255, 0.3);">Meta Ads</span>`
                    : `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium" style="background: rgba(243, 199, 122, 0.15); color: #f3c77a; border: 1px solid rgba(243, 199, 122, 0.3);">Google Ads</span>`;

                let statusBadge = '';
                if (c.health === 'WINNER') statusBadge = '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium" style="background: rgba(126, 240, 200, 0.15); color: var(--dash-success); border: 1px solid rgba(126, 240, 200, 0.3);">Winner</span>';
                else if (c.health === 'RISK') statusBadge = '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium" style="background: rgba(255, 100, 100, 0.15); color: #ff8888; border: 1px solid rgba(255, 100, 100, 0.3);">Risk</span>';
                else if (c.health === 'PROMISING') statusBadge = '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium" style="background: rgba(202, 138, 229, 0.15); color: var(--dash-accent); border: 1px solid rgba(202, 138, 229, 0.3);">Promesa</span>';
                else {
                    const mappedStatus = c.status === 'ENABLED' || c.status === 'ACTIVE' ? 'Active' : c.status === 'PAUSED' ? 'Paused' : c.status || '-';
                    statusBadge = `<span class="text-xs" style="color: var(--dash-muted);">${mappedStatus}</span>`;
                }

                return `
                    <tr style="border-top: 1px solid var(--dash-border); transition: background 0.15s ease;" onmouseover="this.style.background='var(--dash-panel-soft)'" onmouseout="this.style.background='transparent'">
                        <td class="whitespace-nowrap py-3 pl-4 pr-3 text-sm font-medium overflow-hidden text-ellipsis max-w-[200px]" style="color: var(--dash-text);" title="${name}">
                            ${name}
                        </td>
                        <td class="whitespace-nowrap px-3 py-3 text-sm text-left hidden md:table-cell">
                            ${platformBadge}
                        </td>
                        <td class="whitespace-nowrap px-3 py-3 text-sm text-right" style="color: var(--dash-muted);">
                            ${formatCurrencyWithCode(spend, currency)}
                        </td>
                        <td class="whitespace-nowrap px-3 py-3 text-sm font-medium text-right" style="color: var(--dash-text);">
                            ${formatCurrencyWithCode(rev, currency)}
                        </td>
                        <td class="whitespace-nowrap px-3 py-3 text-sm font-semibold text-right ${roas >= 2 ? '' : roas < 1 && spend > 0 ? '' : ''}" style="color: ${roas >= 2 ? 'var(--dash-success)' : roas < 1 && spend > 0 ? '#ff8888' : 'var(--dash-soft)'};">
                            ${roas > 0 ? roas.toFixed(2) + 'x' : '-'}
                        </td>
                        <td class="whitespace-nowrap px-3 py-3 text-sm text-right" style="color: var(--dash-muted);">
                            ${formatCurrencyWithCode(cpa, currency)}
                        </td>
                        <td class="whitespace-nowrap px-3 py-3 text-sm text-center">
                            ${statusBadge}
                        </td>
                    </tr>
                `;
            }).join('');

            container.classList.remove('hidden');
        }

function toggleDataEnrichment(el) {
    const text = document.getElementById('de-toggle-text');
    if(el.checked) {
        text.textContent = 'Active';
        if(window.recentPurchasesState) renderDataEnrichment(window.recentPurchasesState);
        if(document.getElementById('de-payload-list')) document.getElementById('de-payload-list').style.opacity = '1';
    } else {
        text.textContent = 'Paused';
        if(document.getElementById('de-payload-list')) document.getElementById('de-payload-list').style.opacity = '0.5';
    }
}

function describeEnrichmentSignal(label = '', value = '') {
    const key = String(label || '').trim().toLowerCase();
    const safeValue = String(value || '').trim();

    if (key.includes('fbp')) {
        return `Meta browser identifier captured for matching this shopper to Meta conversions.${safeValue ? ` Value: ${safeValue}` : ''}`;
    }
    if (key.includes('fbc') || key.includes('fbclid') || key.includes('click id')) {
        return `Meta click identifier linked to the ad interaction that may have started this journey.${safeValue ? ` Value: ${safeValue}` : ''}`;
    }
    if (key.includes('gclid')) {
        return `Google Ads click identifier used to connect this conversion back to Google traffic.${safeValue ? ` Value: ${safeValue}` : ''}`;
    }
    if (key.includes('ttclid')) {
        return `TikTok click identifier used to connect this conversion back to TikTok traffic.${safeValue ? ` Value: ${safeValue}` : ''}`;
    }
    if (key.includes('email')) {
        return `Email signal available for deterministic matching and post-purchase enrichment.${safeValue ? ` Value: ${safeValue}` : ''}`;
    }
    if (key.includes('phone')) {
        return `Phone signal available for deterministic matching and customer stitching.${safeValue ? ` Value: ${safeValue}` : ''}`;
    }
    if (key.includes('ip')) {
        return `Client IP captured from the purchase or event payload to improve server-side matching.${safeValue ? ` Value: ${safeValue}` : ''}`;
    }
    if (key.includes('user agent')) {
        return `Browser and device signature captured with the event payload for server-side matching.${safeValue ? ` Value: ${safeValue}` : ''}`;
    }

    return `Captured enrichment signal used to improve matching quality for this order.${safeValue ? ` Value: ${safeValue}` : ''}`;
}

function describeEnrichmentPlatform(platform = '') {
    const label = String(platform || '').trim() || 'the destination platform';
    return `This enriched payload was prepared for ${label}.`;
}

function normalizeEnrichmentObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function getEnrichmentPlatformLabel(platform = '') {
    const key = String(platform || '').trim().toLowerCase();
    if (key === 'meta') return 'Meta';
    if (key === 'google') return 'Google';
    if (key === 'tiktok') return 'TikTok';
    return 'Platform';
}

function getEnrichmentStatusLabel(status = '') {
    const key = String(status || '').trim().toLowerCase();
    if (key === 'accepted') return 'Accepted';
    if (key === 'sending') return 'Sending';
    if (key === 'queued') return 'Queued';
    if (key === 'failed') return 'Failed';
    if (key === 'skipped') return 'Skipped';
    return 'Not recorded';
}

function getEnrichmentStatusTone(status = '') {
    const key = String(status || '').trim().toLowerCase();
    if (key === 'accepted') {
        return {
            icon: 'fa-solid fa-check',
            color: '#7ef0c8',
            border: 'rgba(126, 240, 200, 0.32)',
            bg: 'rgba(126, 240, 200, 0.14)',
        };
    }
    if (key === 'sending') {
        return {
            icon: 'fa-solid fa-arrows-rotate',
            color: '#f3c77a',
            border: 'rgba(243, 199, 122, 0.32)',
            bg: 'rgba(243, 199, 122, 0.14)',
        };
    }
    if (key === 'queued') {
        return {
            icon: 'fa-solid fa-hourglass-half',
            color: '#c7b1ff',
            border: 'rgba(199, 177, 255, 0.28)',
            bg: 'rgba(199, 177, 255, 0.14)',
        };
    }
    if (key === 'failed') {
        return {
            icon: 'fa-solid fa-triangle-exclamation',
            color: '#ff8d8d',
            border: 'rgba(255, 141, 141, 0.34)',
            bg: 'rgba(255, 141, 141, 0.12)',
        };
    }
    if (key === 'skipped') {
        return {
            icon: 'fa-solid fa-ban',
            color: '#b7abc9',
            border: 'rgba(183, 171, 201, 0.28)',
            bg: 'rgba(183, 171, 201, 0.12)',
        };
    }
    return {
        icon: 'fa-regular fa-circle-question',
        color: '#d8d0ec',
        border: 'rgba(216, 208, 236, 0.2)',
        bg: 'rgba(216, 208, 236, 0.08)',
    };
}

function normalizeDeliveryStatusInfo(platform = '', rawInfo = {}, purchase = {}) {
    const info = normalizeEnrichmentObject(rawInfo);
    const platformKey = String(platform || info.platform || '').trim().toLowerCase();
    const status = String(info.status || '').trim().toLowerCase() || 'unknown';
    const isEventOnly = String(purchase?.source || '').toLowerCase() === 'events';

    return {
        platform: platformKey,
        platformLabel: getEnrichmentPlatformLabel(platformKey),
        status,
        statusLabel: getEnrichmentStatusLabel(status),
        configured: typeof info.configured === 'boolean' ? info.configured : null,
        sent: Boolean(info.sent || status === 'accepted'),
        reason: String(info.reason || '').trim(),
        destinationId: info.destinationId || null,
        configSource: info.configSource || null,
        attempts: Number(info.attempts || 0) || null,
        updatedAt: info.updatedAt || null,
        queuedAt: info.queuedAt || null,
        sendingAt: info.sendingAt || null,
        acceptedAt: info.acceptedAt || null,
        sentAt: info.sentAt || null,
        failedAt: info.failedAt || null,
        skippedAt: info.skippedAt || null,
        responseSummary: normalizeEnrichmentObject(info.responseSummary),
        verifiedBy: info.verifiedBy || null,
        verificationHint: info.verificationHint || null,
        testEventCode: info.testEventCode || null,
        isEventOnly,
    };
}

function purchaseHasPlatformSignals(purchase = {}, platform = '') {
    const platformKey = String(platform || '').trim().toLowerCase();
    const attributedText = `${purchase?.attributedPlatform || ''} ${purchase?.attributedChannel || ''}`.toLowerCase();
    const events = Array.isArray(purchase?.events)
        ? purchase.events
        : (Array.isArray(purchase?.stitchedEvents) ? purchase.stitchedEvents : []);
    const eventHas = (predicate) => events.some((entry) => {
        const item = entry && typeof entry === 'object' ? entry : {};
        return predicate(item);
    });

    if (platformKey === 'meta') {
        return (
            /(meta|facebook|instagram)/.test(attributedText) ||
            eventHas((item) => Boolean(item.fbp || item.fbc)) ||
            String(purchase?.attributedClickId || '').toLowerCase().startsWith('fb')
        );
    }

    if (platformKey === 'google') {
        return (
            /google/.test(attributedText) ||
            eventHas((item) => Boolean(item.gclid)) ||
            Boolean(purchase?.gclid)
        );
    }

    if (platformKey === 'tiktok') {
        return (
            /tiktok/.test(attributedText) ||
            eventHas((item) => Boolean(item.ttclid)) ||
            Boolean(purchase?.ttclid)
        );
    }

    return false;
}

function buildEnrichmentPlatformStatuses(purchase = {}) {
    const deliveryStatus = normalizeEnrichmentObject(purchase?.deliveryStatus);
    const candidates = ['meta', 'google', 'tiktok'];
    const platforms = candidates.filter((platform) => {
        const rawInfo = normalizeEnrichmentObject(deliveryStatus[platform]);
        return Object.keys(rawInfo).length > 0 || purchaseHasPlatformSignals(purchase, platform);
    });

    return platforms.map((platform) => {
        const rawInfo = normalizeEnrichmentObject(deliveryStatus[platform]);
        if (Object.keys(rawInfo).length) {
            return normalizeDeliveryStatusInfo(platform, rawInfo, purchase);
        }

        if (String(purchase?.source || '').toLowerCase() === 'events') {
            return normalizeDeliveryStatusInfo(platform, {
                status: 'skipped',
                reason: 'This purchase was reconstructed from browser events only, so there is no order-level server delivery receipt.',
                verifiedBy: 'event_only_purchase',
            }, purchase);
        }

        return normalizeDeliveryStatusInfo(platform, {
            status: 'unknown',
            reason: 'No platform delivery receipt has been recorded for this order yet. This usually means the order predates receipt tracking or the sync has not written back a receipt yet.',
            verifiedBy: 'not_recorded',
        }, purchase);
    });
}

function summarizeEnrichmentStatuses(statuses = []) {
    const labels = statuses
        .filter((entry) => entry && entry.platformLabel)
        .map((entry) => `${entry.platformLabel} ${entry.statusLabel.toLowerCase()}`);
    return labels.join(' - ');
}

function resolveOverallEnrichmentStatus(statuses = []) {
    const normalized = Array.isArray(statuses) ? statuses : [];
    if (normalized.some((entry) => entry?.status === 'failed')) return 'failed';
    if (normalized.some((entry) => entry?.status === 'sending')) return 'sending';
    if (normalized.some((entry) => entry?.status === 'queued')) return 'queued';
    if (normalized.some((entry) => entry?.status === 'accepted')) return 'accepted';
    if (normalized.length && normalized.every((entry) => entry?.status === 'skipped')) return 'skipped';
    return 'unknown';
}

function describeEnrichmentDelivery(statusInfo = {}, orderRef = '') {
    const info = normalizeDeliveryStatusInfo(statusInfo.platform || '', statusInfo);
    const summary = normalizeEnrichmentObject(info.responseSummary);
    const timestamp =
        info.acceptedAt ||
        info.sentAt ||
        info.failedAt ||
        info.skippedAt ||
        info.sendingAt ||
        info.queuedAt ||
        info.updatedAt ||
        null;

    const parts = [
        `${info.platformLabel}: ${info.statusLabel}.`,
    ];

    if (orderRef) parts.push(`Order ${String(orderRef).trim()}.`);
    if (info.reason) parts.push(info.reason.endsWith('.') ? info.reason : `${info.reason}.`);
    if (timestamp) parts.push(`Updated ${formatDateTimeMx(timestamp)}.`);
    if (info.destinationId) parts.push(`Destination: ${info.destinationId}.`);
    if (info.configSource) parts.push(`Config source: ${String(info.configSource).replace(/_/g, ' ')}.`);
    if (info.attempts) parts.push(`Attempts: ${info.attempts}.`);
    if (summary.eventsReceived != null) parts.push(`Meta accepted ${summary.eventsReceived} event(s).`);
    if (summary.fbtraceId) parts.push(`fbtrace_id: ${summary.fbtraceId}.`);
    if (summary.resultsCount != null) parts.push(`Google uploaded ${summary.resultsCount} conversion(s).`);
    if (summary.requestId) parts.push(`Request id: ${summary.requestId}.`);
    if (summary.jobId) parts.push(`Job id: ${summary.jobId}.`);
    if (summary.partialFailureMessage) parts.push(`Partial failure: ${summary.partialFailureMessage}.`);
    if (info.testEventCode) parts.push(`Meta test_event_code: ${info.testEventCode}.`);
    if (info.verifiedBy) parts.push(`Verified by ${String(info.verifiedBy).replace(/_/g, ' ')}.`);
    if (info.verificationHint) parts.push(info.verificationHint.endsWith('.') ? info.verificationHint : `${info.verificationHint}.`);

    return parts.join(' ');
}

function renderEnrichmentDeliveryBadges(statuses = [], orderRef = '') {
    return (Array.isArray(statuses) ? statuses : []).map((entry) => {
        const tone = getEnrichmentStatusTone(entry?.status);
        const tooltip = escapeHtmlAttr(describeEnrichmentDelivery(entry, orderRef));
        return `
            <span data-tooltip="${tooltip}" class="inline-flex items-center gap-1 py-0.5 px-2 rounded-full text-[10px] sm:text-xs font-semibold mr-1.5 mb-1.5 cursor-help" style="background:${tone.bg}; color:${tone.color}; border:1px solid ${tone.border};">
                <i class="${tone.icon} text-[10px]"></i>
                ${escapeHtml(entry?.platformLabel || 'Platform')}
                <span style="opacity:0.9;">${escapeHtml(entry?.statusLabel || 'Not recorded')}</span>
            </span>
        `;
    }).join('');
}

function renderDataEnrichment(purchases) {
    console.log('[Data Enrichment] Initializing render. Source purchases:', purchases);
    const list = document.getElementById('de-payload-list');
    if (!list) return;
    const toggle = document.getElementById('de-toggle');
    if (toggle && !toggle.checked) return;
    if (!Array.isArray(purchases) || purchases.length === 0) {
        list.innerHTML = '<p class="text-sm text-gray-400">No recent enrichment events.</p>';
        return;
    }
    const validPurchases = purchases.filter(p => p.orderNumber || p.orderId || p.checkoutToken || p._id || p.id);
    console.log('[Data Enrichment] Valid purchases to display:', validPurchases.length);
    const htmlArgs = validPurchases.slice(0, 10).map(p => {
        let orderId = p.orderNumber || p.orderId || p.checkoutToken || '?';
        let platformText = String(p.attributedPlatform || 'Meta').toLowerCase();
        let displayPlatform = p.attributedPlatform || (p.attributedChannel === 'organic' ? 'CAPI Platform' : 'Meta Ads / CAPI');
        const deliveryStatuses = buildEnrichmentPlatformStatuses(p);
        const overallStatus = resolveOverallEnrichmentStatus(deliveryStatuses);
        const overallTone = getEnrichmentStatusTone(overallStatus);
        const overallSummary = summarizeEnrichmentStatuses(deliveryStatuses) || 'No delivery receipt recorded yet';
        
        let exactData = new Map();
        
        let clientIp = 'Unknown Client IP';
        let userAgent = 'Unknown User Agent';
        let emailVal = 'Unknown Email';
        
        if (p.customerIpAddress || p.ip_address || p.client_ip) clientIp = p.customerIpAddress || p.ip_address || p.client_ip;
        if (p.customerUserAgent || p.user_agent || p.userAgent) userAgent = p.customerUserAgent || p.user_agent || p.userAgent;
        if (p.user_email || p.email) emailVal = p.user_email || p.email;
        else if (p.contact_email) emailVal = p.contact_email;
        else if (p.customer && p.customer.email) emailVal = p.customer.email;

        // Try extracting early if hashes exist
        if (p.emailHash && emailVal === 'Unknown Email') emailVal = p.emailHash;

        let hasAdvancedData = false;
        let eventsArray = Array.isArray(p.events) ? p.events : (Array.isArray(p.stitchedEvents) ? p.stitchedEvents : []);
        
        eventsArray.forEach(evt => {
            const py = evt.payload || evt.rawPayload || evt; // Check py, rawPayload, or flattened evt
            const urlStr = String(py.pageUrl || py.page_url || '').toLowerCase();
            
            if (py.fbp || py._fbp) { exactData.set('FBP', String(py.fbp || py._fbp)); hasAdvancedData = true; }
            if (py.fbc || py._fbc) { exactData.set('FBC (Click id)', String(py.fbc || py._fbc)); hasAdvancedData = true; }
            if (py.ttclid) { exactData.set('TTCLID', String(py.ttclid)); hasAdvancedData = true; }
            if (py.gclid) { exactData.set('GCLID', String(py.gclid)); hasAdvancedData = true; }
            if (py.clickId || py.click_id) { exactData.set('Click ID', String(py.clickId || py.click_id)); hasAdvancedData = true; }
            
            if (urlStr.includes('gclid=')) { exactData.set('GCLID Match', urlStr.split('gclid=')[1].split('&')[0]); hasAdvancedData = true; }
            if (urlStr.includes('ttclid=')) { exactData.set('TTCLID Match', urlStr.split('ttclid=')[1].split('&')[0]); hasAdvancedData = true; }
            if (urlStr.includes('fbclid=')) { exactData.set('FBCLID Match', urlStr.split('fbclid=')[1].split('&')[0]); hasAdvancedData = true; }
            
            if (py.customerEmail || py.customer_email || py.user_email || py.email) emailVal = py.customerEmail || py.customer_email || py.user_email || py.email;
            if (py.clientIp || py.client_ip_address || py.ip_address || py.ip) clientIp = py.clientIp || py.client_ip_address || py.ip_address || py.ip;
            if (py.userAgent || py.client_user_agent || py.user_agent) userAgent = py.userAgent || py.client_user_agent || py.user_agent;
            
            if(py.billing || py.customer) { 
                const phone = (py.billing && py.billing.phone) || (py.customer && py.customer.phone);
                if (phone) exactData.set('Phone (Hashed)', phone); 
            }
        });

        if (emailVal !== 'Unknown Email') exactData.set('Email (Hashed)', emailVal);
        if (clientIp !== 'Unknown Client IP') exactData.set('IP Address', clientIp);
        if (userAgent !== 'Unknown User Agent') exactData.set('User Agent', userAgent);

        if(!hasAdvancedData) {
            if (platformText.includes('meta') || platformText.includes('fb')) { exactData.set('FBP Match', 'Automated CAPI'); exactData.set('Click ID', 'Automated CAPI'); }
            if (platformText.includes('tiktok')) exactData.set('TTCLID Match', 'Automated CAPI'); 
            if (platformText.includes('google')) exactData.set('GCLID Match', 'Automated CAPI');  
        }

        let tagsHtml = Array.from(exactData.entries()).map(([k, v]) => {
            const safeVal = String(v || '');
            const tooltip = escapeHtmlAttr(describeEnrichmentSignal(k, safeVal));
            return `<span data-tooltip="${tooltip}" class="inline-flex items-center py-0.5 px-1.5 rounded text-[10px] sm:text-xs font-medium bg-indigo-500 bg-opacity-20 text-indigo-200 border border-indigo-500 border-opacity-30 mr-1.5 mb-1.5 shadow-sm cursor-help transition-all hover:bg-opacity-40">${escapeHtml(k)}</span>`;
        }).join('');
        const deliveryBadgesHtml = renderEnrichmentDeliveryBadges(deliveryStatuses, orderId);

        return '<div class="p-4 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between mb-3 shadow-sm hover:shadow transition-shadow" style="background-color: rgba(43, 31, 68, 0.6); border: 1px solid rgba(202, 138, 229, 0.15);">' +
            '<div class="flex flex-col w-full sm:pr-4">' +
                '<div class="flex items-center gap-2 mb-2">' +
                    '<span class="text-sm font-bold cursor-help" data-tooltip="' + escapeHtmlAttr(`Enriched order payload for order ${orderId}.`) + '" style="color: #f8fafc !important;">Order #' + escapeHtml(orderId) + '</span>' +
                    '<span class="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full cursor-help" data-tooltip="' + escapeHtmlAttr(describeEnrichmentPlatform(displayPlatform)) + '" style="background-color: rgba(255,255,255,0.05); color: #CA8AE5;">Sync: ' + escapeHtml(displayPlatform) + '</span>' +
                '</div>' +
                '<div class="flex flex-wrap items-center mt-0.5 mb-1">' + deliveryBadgesHtml + '</div>' +
                '<div class="flex flex-wrap items-center mt-1">' + tagsHtml + '</div>' +
            '</div>' +
            '<div class="flex-shrink-0 text-center sm:text-right mt-3 sm:mt-0 flex flex-row sm:flex-col items-center sm:items-end justify-between">' +
                '<div class="w-8 h-8 rounded-full flex items-center justify-center mb-1" style="background-color: ' + overallTone.bg + '; border: 1px solid ' + overallTone.border + ';">' +
                    '<i class="' + overallTone.icon + ' text-xs" style="color: ' + overallTone.color + ';"></i>' +
                '</div>' +
                '<span class="text-[10px] font-semibold uppercase tracking-wider ml-2 sm:ml-0 cursor-help" data-tooltip="' + escapeHtmlAttr(overallSummary) + '" style="color: ' + overallTone.color + ';">' + escapeHtml(getEnrichmentStatusLabel(overallStatus)) + '</span>' +
                '<span class="hidden sm:block text-[10px] mt-1 max-w-[180px] leading-tight" style="color: rgba(225, 216, 243, 0.68);">' + escapeHtml(overallSummary) + '</span>' +
            '</div>' +
        '</div>';
    });
    list.innerHTML = htmlArgs.join('');
}

function renderRecentPurchases(purchases) {
            recentPurchasesState = Array.isArray(purchases) ? purchases.slice() : [];

            const container = document.getElementById('recent-purchases-list');
            if (!container) return;

            const filterValue = document.getElementById('recent-purchases-filter')?.value || 'all';
            const limitValue = Number.parseInt(document.getElementById('recent-purchases-limit')?.value || '100', 10) || 100;
            const sortValue = document.getElementById('recent-purchases-sort')?.value || 'date_desc';

            let filtered = recentPurchasesState.slice();
            if (filterValue === 'orders') filtered = filtered.filter((p) => p.source === 'orders');
            if (filterValue === 'events') filtered = filtered.filter((p) => p.source === 'events');

            filtered.sort((a, b) => {
                if (sortValue === 'date_asc') return new Date(getPurchaseTimestamp(a) || 0).getTime() - new Date(getPurchaseTimestamp(b) || 0).getTime();
                if (sortValue === 'revenue_desc') return Number(b.revenue || 0) - Number(a.revenue || 0);
                if (sortValue === 'revenue_asc') return Number(a.revenue || 0) - Number(b.revenue || 0);
                if (sortValue === 'order_asc') return String(a.orderNumber || a.orderId || '').localeCompare(String(b.orderNumber || b.orderId || ''), 'es');
                if (sortValue === 'order_desc') return String(b.orderNumber || b.orderId || '').localeCompare(String(a.orderNumber || a.orderId || ''), 'es');
                return new Date(getPurchaseTimestamp(b) || 0).getTime() - new Date(getPurchaseTimestamp(a) || 0).getTime();
            });

            if (!Array.isArray(filtered) || filtered.length === 0) {
                container.innerHTML = '<tr><td colspan="8" class="py-6 text-center text-gray-400">No purchases yet.</td></tr>';
                return;
            }

            const limited = filtered.slice(0, Math.max(1, limitValue));

            container.innerHTML = limited.map((p) => {
                const date = formatRecentPurchaseDate(p);
                const orderId = p.orderNumber || p.orderId || p.checkoutToken || '-';
                const customerName = p.customerName || '-';
                const revenue = formatCurrencyWithCode(Number(p.revenue || 0), p.currency || 'MXN');
                const items = Array.isArray(p.items) ? p.items : [];
                const itemsText = items.length
                    ? items.slice(0, 2).map((i) => `${i.name || 'Product'} x${Number(i.quantity || 1)}`).join(' · ')
                    : 'No items';
                const extraCount = items.length > 2 ? ` +${items.length - 2} more` : '';
                const sourceLabel = p.source === 'orders' ? 'Woo Orders Sync' : 'Pixel Events';
                const attrChannel = p.attributedChannel || 'unattributed';
                const attrPlatform = p.attributedPlatform || '-';
                const attrConfidence = Number(p.attributionConfidence || 0);
                let attrText = `${attrChannel} · ${attrPlatform} · ${(attrConfidence * 100).toFixed(0)}%`;
                if (Array.isArray(p.attributionSplits) && p.attributionSplits.length > 1) {
                    const splitText = p.attributionSplits
                        .map((s) => `${s.channel}:${Math.round(Number(s.weight || 0) * 100)}%`)
                        .join(' / ');
                    attrText = splitText;
                }
                if (p.attributionSource === 'woo_fallback' && p.wooSourceLabel) {
                    attrText = p.wooSourceLabel;
                }
                if (p.attributionSource === 'orders_sync' && p.attributedPlatform) {
                    attrText = p.attributedPlatform;
                }
                const resolvedCampaignLabel = resolveAttributedCampaignLabel(p);
                if (resolvedCampaignLabel && resolvedCampaignLabel !== 'No campaign') {
                    attrText += ` · ${resolvedCampaignLabel}`;
                }
                const attrLabel = humanReadableChannel(attrChannel, attrPlatform);
                if (Array.isArray(p.attributionSplits) && p.attributionSplits.length > 1) {
                    attrText = p.attributionSplits
                        .map((s) => `${humanReadableChannel(s.channel || 'unattributed', s.platform || '')}:${Math.round(Number(s.weight || 0) * 100)}%`)
                        .join(' / ');
                } else {
                    attrText = `${attrLabel} · ${(attrConfidence * 100).toFixed(0)}%`;
                    if (resolvedCampaignLabel && resolvedCampaignLabel !== 'No campaign') {
                        attrText += ` · ${resolvedCampaignLabel}`;
                    }
                }
                const debugBits = [];
                if (p.attributionDebug?.wooSourceLabel) debugBits.push(`woo=${p.attributionDebug.wooSourceLabel}`);
                if (p.attributionDebug?.payloadUtmSource) debugBits.push(`utm=${p.attributionDebug.payloadUtmSource}`);
                if (p.attributionDebug?.payloadReferrer) debugBits.push(`ref=${p.attributionDebug.payloadReferrer}`);
                if (p.attributedCampaignLabel || p.attributedCampaign) debugBits.push(`campaign=${p.attributedCampaignLabel || p.attributedCampaign}`);
                if (p.attributedClickId) debugBits.push(`click=${p.attributedClickId}`);
                const debugTitle = debugBits.length ? ` title="${debugBits.join(' | ')}"` : '';
                const debugText = debugBits.length ? debugBits.join(' | ') : '-';

                return `
                    <tr class="border-b border-gray-100 align-top">
                        <td class="py-3 pr-4 text-gray-700 whitespace-nowrap">${date}</td>
                        <td class="py-3 pr-4 text-gray-900 font-medium">${orderId}</td>
                        <td class="py-3 pr-4 text-indigo-600 cursor-pointer hover:underline" onclick="focusJourneyProfile({ userKey: '${escapeInlineSingleQuotedJs(p.userKey || '')}', customerId: '${escapeInlineSingleQuotedJs(p.customerId || '')}', fallbackName: '${escapeInlineSingleQuotedJs(customerName)}' })">${customerName}</td>
                        <td class="py-3 pr-4 text-indigo-600 font-semibold whitespace-nowrap">${revenue}</td>
                        <td class="py-3 pr-4 text-gray-700">${itemsText}${extraCount}</td>
                        <td class="py-3 pr-4 text-gray-700 whitespace-nowrap"${debugTitle}>${attrText}</td>
                        <td class="py-3 pr-4 text-gray-500 whitespace-nowrap">${sourceLabel}</td>
                        <td class="py-3 pr-4 text-gray-500">${debugText}</td>
                    </tr>
                `;
            }).join('');
        }

        function renderAttributionChart(attributionData, paidMedia = {}) {
            const ctx = document.getElementById('attributionChart').getContext('2d');

            if (attributionChartInstance) attributionChartInstance.destroy();

            // Comparar ROAS de AdNova vs Platform para los canales de pauta
            const platforms = ['meta', 'google', 'tiktok'];
            const labels = [];
            const adnovaRoasData = [];
            const platformRoasData = [];

              console.log('=== START CHART DEBUG ===');
              console.log('Attribution Data Built:', attributionData);
              console.log('Paid Media Info received:', paidMedia);

              platforms.forEach(p => {
                  const attrInfo = attributionData.find(d => d.channel.toLowerCase() === p) || { revenue: 0 };
                  const pmInfo = paidMedia[p] || {};
                  const spend = Number(pmInfo.spend) || 0;

                  let adnovaRoas = 0;
                  if (spend > 0) {
                      adnovaRoas = attrInfo.revenue / spend;
                  }

                  let platformRoas = pmInfo.roas != null ? Number(pmInfo.roas) : (spend > 0 ? (Number(pmInfo.revenue)||0) / spend : 0);

                  console.log(`Evaluating '${p}' -> AdNova Rev: $${attrInfo.revenue}, Platform Spend: $${spend}, Platform Rev: $${pmInfo.revenue||0}, Platform ROAS reported: ${pmInfo.roas||0}`);
                  console.log(`Calculated for chart -> AdNova ROAS: ${adnovaRoas.toFixed(2)}x, Platform ROAS: ${platformRoas.toFixed(2)}x`);

                  if (spend > 0 || attrInfo.revenue > 0 || platformRoas > 0) {  
                      labels.push(p.charAt(0).toUpperCase() + p.slice(1));      
                      adnovaRoasData.push(Number(adnovaRoas.toFixed(2)));       
                      platformRoasData.push(Number(platformRoas.toFixed(2)));   
                  }
              });
              console.log('=== END CHART DEBUG ===');

              // Fallback in case there is no data yet
              if (labels.length === 0) {
                  labels.push('Meta', 'Google');
                  adnovaRoasData.push(0, 0);
            }

            attributionChartInstance = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: 'AdNova ROAS',
                            data: adnovaRoasData,
                            backgroundColor: '#CA8AE5',
                            borderColor: 'transparent',
                            borderWidth: 1,
                            borderRadius: 4
                        },
                        {
                            label: 'Platform ROAS',
                            data: platformRoasData,
                            backgroundColor: '#7EF0C8',
                            borderColor: 'transparent',
                            borderWidth: 1,
                            borderRadius: 4
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: { color: 'rgba(200, 200, 200, 0.1)' },
                            ticks: { color: '#6b7280' }
                        },
                        x: {
                            grid: { display: false },
                            ticks: { color: '#6b7280' }
                        }
                    },
                    plugins: {
                        legend: {
                            position: 'top',
                            labels: {
                                color: '#374151',
                                usePointStyle: true,
                                padding: 15
                            }
                        },
                        tooltip: {
                            backgroundColor: 'rgba(12, 8, 19, 0.95)',
                            titleColor: '#F4F1FF',
                            bodyColor: 'rgba(225, 216, 243, 0.9)',
                            callbacks: {
                                label: function(context) {
                                    return `${context.dataset.label}: ${context.parsed.y}x`;
                                }
                            }
                        }
                    }
                }
            });
        }

        
        
        function renderAttributionPieChart(attributionArray) {
            const ctx = document.getElementById('attributionPieChart')?.getContext('2d');
            if (!ctx) return;
            
            const labels = [];
            const values = [];
            const backgroundColors = [];
            const iconMap = {
                'meta': 'fa-brands fa-meta',
                'google': 'fa-brands fa-google',
                'tiktok': 'fa-brands fa-tiktok',
                'klaviyo': 'fa-solid fa-envelope',
                'organic': 'fa-solid fa-globe',
                'direct': 'fa-solid fa-globe',
                'referral': 'fa-solid fa-share-nodes',
                'email': 'fa-solid fa-envelope',
                'unattributed': 'fa-solid fa-question'
            };
            const colorsMap = {
                'meta': 'rgba(66, 103, 178, 0.8)',
                'google': 'rgba(219, 68, 55, 0.8)',
                'tiktok': 'rgba(255, 255, 255, 0.8)', // Better visibility for tiktok pie chunk
                'klaviyo': 'rgba(123, 222, 187, 0.8)',
                'organic': 'rgba(134, 239, 172, 0.8)',
                'direct': 'rgba(134, 239, 172, 0.8)',
                'referral': 'rgba(96, 165, 250, 0.82)',
                'email': 'rgba(123, 222, 187, 0.82)',
                'organic/direct': 'rgba(134, 239, 172, 0.8)',
                'unattributed': 'rgba(156, 163, 175, 0.4)'
            };
            
            let legendHtml = '';
            
            // attributionArray is an array of objects: { channel, revenue, orders }
            const dataToIterate = Array.isArray(attributionArray) ? attributionArray : [];

            for (const stats of dataToIterate) {
                const channelRaw = String(stats.channel || 'unattributed').toLowerCase();
                // Determine base key for styling (klaviyo, organic, etc)
                let cKey = channelRaw;
                if (channelRaw.includes('organic') || channelRaw.includes('direct')) cKey = 'organic';
                if (channelRaw.includes('facebook') || channelRaw.includes('meta') || channelRaw.includes('ig')) cKey = 'meta';
                if (channelRaw.includes('referral')) cKey = 'referral';
                if (channelRaw.includes('email')) cKey = 'email';

                if (cKey === 'unattributed' && (stats.orders || 0) === 0) continue;
                if ((stats.orders || 0) === 0 && (stats.revenue || 0) === 0) continue;

                let displayName = humanReadableChannel(channelRaw).toUpperCase();
                if (cKey === 'organic' && channelRaw === 'organic') displayName = 'ORGANIC';

                labels.push(displayName);
                values.push(stats.orders || 0);

                const hexColor = colorsMap[cKey] || colorsMap[channelRaw] || 'rgba(156, 163, 175, 0.8)';
                backgroundColors.push(hexColor);

                const icon = iconMap[cKey] || iconMap[channelRaw] || 'fa-solid fa-circle';
                
                const formattedOrders = Number.isInteger(stats.orders) ? stats.orders : Number(stats.orders).toFixed(1);

                legendHtml += `
                    <div class="flex items-center text-gray-300">
                        <div class="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full mr-2" style="background: ${hexColor.replace('0.8', '0.2')}">
                            <i class="${icon} text-xs" style="color: ${hexColor.replace('0.8', '1')}"></i>
                        </div>
                        <div class="flex-1 min-w-0">
                            <p class="text-[0.8rem] font-medium truncate text-gray-200">${displayName}</p>
                            <p class="text-xs text-indigo-300">${formattedOrders} ${stats.orders === 1 ? 'order' : 'orders'}</p>
                        </div>
                    </div>
                `;
            }

            const legendContainer = document.getElementById('pieChartLegend');
            if (legendContainer) {
                legendContainer.innerHTML = legendHtml || '<p class="text-xs text-gray-500">No data</p>';
            }

            if (attributionPieChartInstance) attributionPieChartInstance.destroy();

            attributionPieChartInstance = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: labels,
                    datasets: [{
                        data: values,
                        backgroundColor: backgroundColors,
                        borderWidth: 1,
                        borderColor: '#120c1d'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '70%',
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(18, 12, 29, 0.95)',
                            titleColor: '#f4f1ff',
                            bodyColor: '#e1d8f3',
                            borderColor: 'rgba(202, 138, 229, 0.3)',
                            borderWidth: 1,
                            callbacks: {
                                label: function(context) {
                                    let value = context.raw || 0;
                                    return ' ' + value + (value === 1 ? ' order' : ' orders');
                                }
                            }
                        }
                    }
                }
            });
        }

        // --- LIVE FEED (SSE) ---
        function translateEventNameSimple(rawName) {
            const key = String(rawName || '').trim().toLowerCase();
            if (key === 'page_view') return 'Page view';
            if (key === 'view_item') return 'Viewed product';
            if (key === 'add_to_cart' || key === 'added_to_cart' || key === 'cart_add' || key === 'addtocart') return 'Added to cart';
            if (key === 'view_cart') return 'Viewed cart';
            if (key === 'begin_checkout') return 'Started checkout';
            if (key === 'purchase') return 'Purchase';
            if (key === 'user_logged_in' || key === 'user_login' || key === 'login') return 'User login';
            if (key === 'user_logged_out' || key === 'user_logout' || key === 'logout') return 'User logout';
            if (key === 'connected') return 'User connected';
            return String(rawName || 'Event');
        }

        function translateRawSourceSimple(value) {
            const key = String(value || '').trim().toLowerCase();
            if (!key) return 'source not detected';
            if (key === 'pixel') return 'pixel';
            if (key === 'webhook') return 'webhook';
            if (key === 'server') return 'server';
            return key;
        }

        function translateMatchTypeSimple(value) {
            const key = String(value || '').trim().toLowerCase();
            if (!key) return 'no type';
            if (key === 'deterministic') return 'exact match';
            if (key === 'probabilistic') return 'probable match';
            if (key === 'hybrid') return 'hybrid match';
            return key;
        }

        function formatConfidenceSimple(value) {
            const n = Number(value);
            if (!Number.isFinite(n)) return 'no data';
            const pct = Math.max(0, Math.min(100, Math.round(n * 100)));
            if (pct >= 85) return `${pct}% (high)`;
            if (pct >= 60) return `${pct}% (medium)`;
            return `${pct}% (low)`;
        }

        function buildSignalTextSimple(payload = {}) {
            const source = translateRawSourceSimple(payload.rawSource);
            const match = translateMatchTypeSimple(payload.matchType);
            const confidence = formatConfidenceSimple(payload.confidenceScore);
            return `${source} | ${match} | confidence ${confidence}`;
        }

        function resolveLiveFeedUserLabel({ sessionId = null, userKey = null } = {}) {
            return resolveOnlineUserIdentity({ sessionId, userKey }).label;
        }

        function resolveLiveFeedAttribution(payload = {}) {
            let source = String(payload.utm_source || payload.utmSource || '').toLowerCase();
            let medium = String(payload.utm_medium || payload.utmMedium || '').toLowerCase();
            let ref = String(payload.referrer || '').toLowerCase();
            let hasGclid = !!payload.gclid;
            let hasFbclid = !!payload.fbclid;
            let hasTtclid = !!payload.ttclid;
            
            if (payload.pageUrl) {
                try {
                    const url = new URL(payload.pageUrl);
                    const params = url.searchParams;
                    if (params.get('utm_source')) source = params.get('utm_source').toLowerCase();
                    if (params.get('utm_medium')) medium = params.get('utm_medium').toLowerCase();
                    if (params.has('gclid')) hasGclid = true;
                    if (params.has('fbclid')) hasFbclid = true;
                    if (params.has('ttclid')) hasTtclid = true;
                } catch(e) {}
            }

            if (hasFbclid || source.includes('facebook') || source.includes('instagram') || source.includes('meta')) {
                let badgeTxt = (medium.includes('organic') && !hasFbclid) ? 'Meta Organic' : 'Meta Ads';
                let icon = (medium.includes('organic') && !hasFbclid) ? 'fa-solid fa-globe' : 'fa-brands fa-meta';
                return { text: badgeTxt, icon: icon, color: '!text-purple-700', bg: 'bg-blue-100' };
            }
            if (hasTtclid || source.includes('tiktok')) {
                return { text: 'TikTok', icon: 'fa-brands fa-tiktok', color: '!text-purple-700', bg: 'bg-teal-100' };
            }
            if (hasGclid || medium.includes('cpc') || source.includes('google') || source.includes('ads')) {
                if (medium.includes('organic') || (!hasGclid && !medium.includes('cpc') && !medium.includes('paid'))) {
                    return { text: 'Google Organic', icon: 'fa-solid fa-globe', color: '!text-purple-700', bg: 'bg-emerald-100' };
                }
                return { text: 'Google Ads', icon: 'fa-brands fa-google', color: '!text-purple-700', bg: 'bg-orange-100' };
            }
            if (ref.includes('google')) return { text: 'Organic Search', icon: 'fa-solid fa-globe', color: '!text-purple-700', bg: 'bg-emerald-100' };
            if (ref.includes('facebook') || ref.includes('instagram')) return { text: 'Meta Organic', icon: 'fa-solid fa-globe', color: '!text-purple-700', bg: 'bg-emerald-100' };
            if (ref.includes('tiktok')) return { text: 'TikTok Organic', icon: 'fa-solid fa-globe', color: '!text-purple-700', bg: 'bg-emerald-100' };
            
            if (source && source !== 'null' && source !== 'undefined') return { text: source.charAt(0).toUpperCase() + source.slice(1), icon: 'fa-solid fa-link', color: '!text-purple-700', bg: 'bg-indigo-100' };
            if (ref && !ref.includes(location.hostname)) return { text: 'Referral', icon: 'fa-solid fa-link', color: '!text-purple-700', bg: 'bg-indigo-100' };

            return { text: 'Direct', icon: 'fa-solid fa-bolt', color: '!text-purple-700', bg: 'bg-gray-200' };
        }

        let activeLiveFeedFilterSessionId = null;
        let liveFeedScrollbarRaf = null;
        let liveFeedScrollbarResizeObserver = null;
        let liveFeedScrollbarMutationObserver = null;
        function updateLiveFeedFilterVisuals() {
            const container = document.getElementById('feed-container');
            if (!container) return;
            const items = container.querySelectorAll('.feed-item');
            items.forEach(el => {
                if (!activeLiveFeedFilterSessionId) {
                    el.style.display = '';
                    el.classList.remove('opacity-50');
                } else {
                    const sid = el.getAttribute('data-live-session-id');
                    if (sid === activeLiveFeedFilterSessionId) {
                        el.style.display = '';
                        el.classList.remove('opacity-50');
                    } else {
                        el.style.display = 'none';
                    }
                }
            });
            scheduleLiveFeedScrollbarSync();
        }

        function getLiveFeedScrollbarElements() {
            const wrap = document.getElementById('live-feed-scroll-wrap');
            const container = document.getElementById('feed-container');
            const rail = document.getElementById('live-feed-scrollbar');
            const thumb = document.getElementById('live-feed-scroll-thumb');
            return { wrap, container, rail, thumb };
        }

        function syncLiveFeedScrollbar() {
            liveFeedScrollbarRaf = null;
            const { wrap, container, rail, thumb } = getLiveFeedScrollbarElements();
            if (!wrap || !container || !rail || !thumb) return;

            const maxScroll = Math.max(0, wrap.scrollHeight - wrap.clientHeight);
            if (maxScroll <= 1) {
                rail.classList.add('is-hidden');
                thumb.style.height = '0px';
                thumb.style.transform = 'translateY(0px)';
                return;
            }

            rail.classList.remove('is-hidden');

            const railHeight = rail.clientHeight || Math.max(1, wrap.clientHeight - 32);
            const thumbHeight = Math.max(42, Math.round((wrap.clientHeight / wrap.scrollHeight) * railHeight));
            const maxThumbY = Math.max(0, railHeight - thumbHeight);
            const progress = maxScroll > 0 ? (wrap.scrollTop / maxScroll) : 0;
            const thumbY = Math.round(maxThumbY * progress);

            thumb.style.height = `${thumbHeight}px`;
            thumb.style.transform = `translateY(${thumbY}px)`;
        }

        function scheduleLiveFeedScrollbarSync() {
            if (liveFeedScrollbarRaf) cancelAnimationFrame(liveFeedScrollbarRaf);
            liveFeedScrollbarRaf = requestAnimationFrame(syncLiveFeedScrollbar);
        }

        function initializeLiveFeedScrollbar() {
            const { wrap, container, rail, thumb } = getLiveFeedScrollbarElements();
            if (!wrap || !container || !rail || !thumb) return;
            if (wrap.dataset.scrollbarReady === '1') {
                scheduleLiveFeedScrollbarSync();
                return;
            }

            wrap.dataset.scrollbarReady = '1';
            wrap.addEventListener('scroll', scheduleLiveFeedScrollbarSync, { passive: true });
            window.addEventListener('resize', scheduleLiveFeedScrollbarSync);

            const proxyWheelToWrap = (event) => {
                event.preventDefault();
                wrap.scrollTop += event.deltaY;
                scheduleLiveFeedScrollbarSync();
            };

            rail.addEventListener('wheel', proxyWheelToWrap, { passive: false });
            thumb.addEventListener('wheel', proxyWheelToWrap, { passive: false });

            if ('ResizeObserver' in window) {
                liveFeedScrollbarResizeObserver = new ResizeObserver(() => {
                    scheduleLiveFeedScrollbarSync();
                });
                liveFeedScrollbarResizeObserver.observe(wrap);
                liveFeedScrollbarResizeObserver.observe(container);
            }

            if ('MutationObserver' in window) {
                liveFeedScrollbarMutationObserver = new MutationObserver(() => {
                    scheduleLiveFeedScrollbarSync();
                });
                liveFeedScrollbarMutationObserver.observe(container, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                });
            }

            let dragState = null;

            const stopDrag = () => {
                dragState = null;
                thumb.classList.remove('is-dragging');
            };

            thumb.addEventListener('pointerdown', (event) => {
                event.preventDefault();
                const railRect = rail.getBoundingClientRect();
                const thumbRect = thumb.getBoundingClientRect();
                dragState = {
                    pointerId: event.pointerId,
                    startY: event.clientY,
                    startThumbY: thumbRect.top - railRect.top,
                };
                thumb.classList.add('is-dragging');
                if (thumb.setPointerCapture) thumb.setPointerCapture(event.pointerId);
            });

            thumb.addEventListener('pointermove', (event) => {
                if (!dragState || event.pointerId !== dragState.pointerId) return;
                event.preventDefault();
                const railHeight = rail.clientHeight || 1;
                const thumbHeight = thumb.offsetHeight || 0;
                const maxThumbY = Math.max(0, railHeight - thumbHeight);
                const nextThumbY = Math.min(
                    maxThumbY,
                    Math.max(0, dragState.startThumbY + (event.clientY - dragState.startY))
                );
                const maxScroll = Math.max(0, wrap.scrollHeight - wrap.clientHeight);
                wrap.scrollTop = maxThumbY > 0 ? (nextThumbY / maxThumbY) * maxScroll : 0;
                scheduleLiveFeedScrollbarSync();
            });

            thumb.addEventListener('pointerup', stopDrag);
            thumb.addEventListener('pointercancel', stopDrag);
            thumb.addEventListener('lostpointercapture', stopDrag);

            rail.addEventListener('pointerdown', (event) => {
                if (event.target === thumb) return;
                const railRect = rail.getBoundingClientRect();
                const thumbHeight = thumb.offsetHeight || 0;
                const maxThumbY = Math.max(0, railRect.height - thumbHeight);
                const clickY = event.clientY - railRect.top - (thumbHeight / 2);
                const targetThumbY = Math.min(maxThumbY, Math.max(0, clickY));
                const maxScroll = Math.max(0, wrap.scrollHeight - wrap.clientHeight);
                wrap.scrollTo({
                    top: maxThumbY > 0 ? (targetThumbY / maxThumbY) * maxScroll : 0,
                    behavior: 'smooth',
                });
            });

            scheduleLiveFeedScrollbarSync();
        }

        function preserveLiveFeedPositionAfterPrepend(wrap, previousScrollTop, previousScrollHeight, stickToTop) {
            if (!wrap) return;

            requestAnimationFrame(() => {
                const nextScrollHeight = Math.max(0, wrap.scrollHeight || 0);
                const growth = Math.max(0, nextScrollHeight - previousScrollHeight);

                if (stickToTop) {
                    wrap.scrollTop = 0;
                } else if (growth > 0) {
                    wrap.scrollTop = previousScrollTop + growth;
                } else {
                    wrap.scrollTop = previousScrollTop;
                }

                scheduleLiveFeedScrollbarSync();
            });
        }

        function resolveLiveFeedProductLabel(payload = {}) {
            const itemCandidate = Array.isArray(payload.items) ? (payload.items[0] || {}) : {};
            const label = [
                payload.product_name,
                payload.productName,
                payload.item_name,
                payload.itemName,
                payload.name,
                payload.title,
                itemCandidate.product_name,
                itemCandidate.productName,
                itemCandidate.item_name,
                itemCandidate.itemName,
                itemCandidate.name,
                itemCandidate.title,
            ]
                .map((value) => String(value || '').trim())
                .find(Boolean);

            if (label) return label;

            const pageUrl = String(payload.pageUrl || payload.page_url || payload.url || '').trim();
            if (pageUrl) {
                try {
                    const pathname = new URL(pageUrl, window.location.origin).pathname || '';
                    const segments = pathname.split('/').filter(Boolean);
                    const last = segments[segments.length - 1] || '';
                    const humanized = last
                        .replace(/[-_]+/g, ' ')
                        .replace(/\b\w/g, (m) => m.toUpperCase())
                        .trim();
                    if (humanized && !/^\d+$/.test(humanized)) return humanized;
                } catch (_) {}
            }

            return '';
        }

        function connectLiveFeed() {
            if (!currentShopId) return;

            const evtSource = new EventSource(`/api/feed/${currentShopId}`);
            const wrap = document.getElementById('live-feed-scroll-wrap');
            const container = document.getElementById('feed-container');
            const placeholder = document.getElementById('feed-placeholder');
            const liveFeedStatus = document.getElementById('live-feed-status');
              const recentOrders = new Set();

            initializeLiveFeedScrollbar();
            scheduleLiveFeedScrollbarSync();

            evtSource.onopen = function() {
                if (liveFeedStatus) liveFeedStatus.textContent = 'Live Feed Active';
            };

            evtSource.onmessage = function(event) {
                if (placeholder) placeholder.style.display = 'none';

                const previousScrollTop = Number(wrap?.scrollTop || 0);
                const previousScrollHeight = Number(wrap?.scrollHeight || 0);
                const isBrowsingOlderEvents = previousScrollTop > 24;

                const data = JSON.parse(event.data);

                  const testOrderId = data.payload?.orderId || data.payload?.order_id || null;
                  if (testOrderId) {
                      if (recentOrders.has(testOrderId)) return;
                      recentOrders.add(testOrderId);
                      if (recentOrders.size > 100) recentOrders.clear();
                  }
                
                // Only show relevant events
                if (data.type === 'PING') return;

                const el = document.createElement('div');
                el.className = 'feed-item bg-gray-50 p-3 rounded border-l-4 feed-item-enter border-indigo-500 shadow-sm text-sm';
                
                let icon = 'fa-info-circle';
                let color = 'text-indigo-600';
                let title = data.type;
                let detail = '';
                const sessionId = data.sessionId || data.payload?.sessionId || null;
                const userKey = data.userKey || data.payload?.userKey || null;
                const resolvedIdentity = resolveLiveFeedIdentity({ sessionId, userKey, payload: data.payload || {} });
                const linkedUserLabel = resolvedIdentity.label;
                const resolvedUserKey = resolvedIdentity.userKey || '';
                const resolvedSessionId = resolvedIdentity.sessionId || String(sessionId || '');
                const readableSession = humanReadableSessionLabel({ linkedUserLabel, sessionId: resolvedSessionId });
                const productLabel = resolveLiveFeedProductLabel(data.payload || {});

                let isPurchaseEvent = false;
                let isCartEvent = false;
                const attrInfo = resolveLiveFeedAttribution(data.payload || {});

                if (data.type === 'COLLECT') {
                    const evtNameLow = String(data.payload.eventName || data.payload.event_name || '').toLowerCase();
                    icon = 'fa-mouse-pointer';
                    color = '!text-blue-500';
                    title = translateEventNameSimple(data.payload.eventName || data.payload.event_name || 'Event');
                    detail = data.payload.pageUrl ? new URL(data.payload.pageUrl).pathname : '';

                    if (evtNameLow === 'purchase') {
                        icon = 'fa-shopping-cart';
                        color = '!text-gray-900';
                        isPurchaseEvent = true;
                    } else if (evtNameLow === 'add_to_cart') {
                        icon = 'fa-cart-plus';
                        color = '!text-gray-900';
                        isCartEvent = true;
                        detail = productLabel || detail;
                    }
                } else if (data.type === 'WEBHOOK') {
                    icon = 'fa-server';
                    color = '!text-gray-900';
                    const platformName = String(data.payload?.platform || '').toLowerCase();
                    title = platformName.includes('woo') ? 'WooCommerce Order' : 'Shopify Order';
                    detail = data.payload?.orderId ? `Order ${data.payload.orderId}` : 'New order processed';
                    isPurchaseEvent = true;
                } else {
                    title = translateEventNameSimple(data.type || 'Event');     
                    if (title.toLowerCase().includes('purchase')) {
                        isPurchaseEvent = true;
                        color = '!text-gray-900';
                    }
                }

                if (resolvedSessionId) {
                    el.setAttribute('data-live-session-id', resolvedSessionId); 
                    if (activeLiveFeedFilterSessionId && activeLiveFeedFilterSessionId !== resolvedSessionId) {
                        el.style.display = 'none';
                    }
                }

                el.classList.add('cursor-pointer', 'hover:bg-gray-100');        
                if (isPurchaseEvent) {
                    el.classList.remove('bg-gray-50', 'border-indigo-500');     
                    el.classList.add('bg-yellow-50', 'border-yellow-400');      
                } else if (isCartEvent) {
                    el.classList.remove('bg-gray-50', 'border-indigo-500');     
                    el.classList.add('bg-blue-50', 'border-blue-400');      
                }

                if (isPurchaseEvent || isCartEvent) {
                    el.classList.add('is-commerce-highlight');
                }

                const titleColor = (isPurchaseEvent || isCartEvent) ? 'live-feed-event-title font-bold' : 'live-feed-event-title text-gray-200 font-medium';
                const detailColor = (isPurchaseEvent || isCartEvent) ? 'live-feed-detail !text-purple-200' : 'text-gray-400';

                el.innerHTML = `
                    <div class="flex items-start">
                        <div class="flex-shrink-0 pt-0.5">
                            <i class="fas ${icon} ${color} live-feed-event-icon"></i>
                        </div>
                        <div class="ml-3 w-0 flex-1">
                            <div class="flex justify-between items-start">
                                <p class="text-sm ${titleColor}">${title}</p>
                                <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${attrInfo.bg} ${attrInfo.color}">
                                    <i class="${attrInfo.icon} text-[9px]"></i> ${attrInfo.text}
                                </span>
                            </div>
                            ${linkedUserLabel ? `<p class="text-xs font-semibold !text-indigo-700 truncate cursor-pointer live-feed-always-visible-user mt-0.5" title="Click to filter this user's events">${linkedUserLabel}</p>` : `<p class="text-xs ${(isPurchaseEvent||isCartEvent)?'!text-gray-600':'text-gray-400'} italic mt-0.5">Anonymous</p>`}
                            <p class="text-xs ${detailColor} truncate mt-0.5">${detail || '-'}</p>
                            <div class="feed-extra mt-1">
                                <p class="text-[11px] !text-indigo-500">${buildSignalTextSimple(data.payload || {})}</p>
                                <p class="text-[11px] !text-indigo-600">${readableSession}</p>
                                ${linkedUserLabel ? `<p class="text-[11px] text-emerald-600">u: <button type="button" class="live-feed-user-link underline decoration-dotted cursor-pointer" data-user-key="${resolvedUserKey.replace(/"/g, '&quot;')}" data-session-id="${resolvedSessionId.replace(/"/g, '&quot;')}" data-user-name="${linkedUserLabel.replace(/"/g, '&quot;')}">${linkedUserLabel}</button></p>` : `<p class="text-[11px] text-gray-500 italic">No logged-in identity available</p>`}
                                <p class="text-[10px] text-gray-400">${formatTimeMx()}</p>
                            </div>
                        </div>
                    </div>
                `;

                const shortUserButton = el.querySelector('.live-feed-always-visible-user');
                if (shortUserButton) {
                    shortUserButton.addEventListener('click', (ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        if (activeLiveFeedFilterSessionId === resolvedSessionId) {
                            activeLiveFeedFilterSessionId = null;
                        } else {
                            activeLiveFeedFilterSessionId = resolvedSessionId;
                        }
                        updateLiveFeedFilterVisuals();
                    });
                }

                const userButton = el.querySelector('.live-feed-user-link');
                if (userButton) {
                    userButton.addEventListener('click', (ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        if (activeLiveFeedFilterSessionId === resolvedSessionId) {
                            activeLiveFeedFilterSessionId = null;
                        } else {
                            activeLiveFeedFilterSessionId = resolvedSessionId;
                        }
                        updateLiveFeedFilterVisuals();
                    });
                }

                if (sessionId) {
                    el.addEventListener('click', () => focusJourneyProfile({ sessionId, fallbackName: linkedUserLabel || 'User' }));
                }

                container.prepend(el);

                if (data.type === 'COLLECT') {
                    const eventName = String(data.payload?.eventName || data.payload?.event_name || '').toLowerCase();
                    if (eventName === 'user_logged_in' || eventName === 'user_login' || eventName === 'login') {
                        fetchWordPressUsersOnline();
                    }
                }

                // Limit feed size
                if (container.children.length > 50) {
                    container.lastElementChild.remove();
                }

                preserveLiveFeedPositionAfterPrepend(
                    wrap,
                    previousScrollTop,
                    previousScrollHeight,
                    !isBrowsingOlderEvents
                );
            };

            evtSource.onerror = function(err) {
                console.error("EventSource failed:", err);
                if (liveFeedStatus) liveFeedStatus.textContent = 'Live Feed reconnecting...';
            };

            wrap?.addEventListener('mouseenter', scheduleLiveFeedScrollbarSync, { passive: true });
        }

        // --- UTILS ---
        const DASHBOARD_TIMEZONE = 'America/Mexico_City';

        function formatMxDateBase(value) {
            if (!value) return '-';
            const d = value instanceof Date ? value : new Date(value);
            if (Number.isNaN(d.getTime())) return '-';

            const parts = new Intl.DateTimeFormat('en-US', {
                timeZone: DASHBOARD_TIMEZONE,
                day: 'numeric',
                month: 'short',
                year: 'numeric',
            }).formatToParts(d);

            const day = parts.find((p) => p.type === 'day')?.value || '';
            const month = (parts.find((p) => p.type === 'month')?.value || '').replace('.', '');
            const year = parts.find((p) => p.type === 'year')?.value || '';
            if (!day || !month || !year) return '-';
            return `${day} ${month} ${year}`;
        }

        function formatMxTimeBase(value) {
            if (!value) return '-';
            const d = value instanceof Date ? value : new Date(value);
            if (Number.isNaN(d.getTime())) return '-';
            return new Intl.DateTimeFormat('en-US', {
                timeZone: DASHBOARD_TIMEZONE,
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
            }).format(d);
        }

        function formatDateTimeMx(value) {
            const datePart = formatMxDateBase(value);
            const timePart = formatMxTimeBase(value);
            if (datePart === '-' || timePart === '-') return '-';
            return `${datePart} · ${timePart}`;
        }

        function formatTimeMx(value = new Date()) {
            const datePart = formatMxDateBase(value);
            const timePart = formatMxTimeBase(value);
            if (datePart === '-' || timePart === '-') return '-';
            return `${datePart} · ${timePart}`;
        }

        function formatCurrency(value) {
            return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'MXN' }).format(value);
        }

        function formatCurrencyWithCode(value, currencyCode) {
            const code = currencyCode || 'MXN';
            try {
                return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(value || 0);
            } catch (_) {
                return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'MXN' }).format(value || 0);
            }
        }

        function formatRoas(value) {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? `${parsed.toFixed(2)}x` : '-';
        }

        function formatPercent(value) {
            return `${(Number(value || 0) * 100).toFixed(1)}%`;
        }

        function formatDuration(seconds) {
            const total = Number(seconds || 0);
            const mins = Math.floor(total / 60);
            const secs = total % 60;
            return `${mins}m ${secs}s`;
        }

        function getPurchaseTimestamp(purchase = {}) {
            return purchase.platformCreatedAt || purchase.createdAt || null;
        }

        function formatRecentPurchaseDate(purchase = {}) {
            const rawTs = getPurchaseTimestamp(purchase);
            if (!rawTs) return '-';
            const d = new Date(rawTs);
            if (Number.isNaN(d.getTime())) return '-';
            // se restaron las 6 horas que se sumaban previamente
            return formatDateTimeMx(d);
        }

        function onAttributionModelChange() {
            fetchAnalytics();
        }

        // Start
        init();


function openUserExplorer(userKey, fallbackName) {
    focusJourneyProfile({
        userKey: userKey || '',
        fallbackName: fallbackName || 'Cliente',
    });
}

function closeUserExplorer() {
    const backdrop = document.getElementById('user-explorer-backdrop');
    const panel = document.getElementById('user-explorer-panel');
    
    panel.classList.remove('translate-x-0');
    panel.classList.add('translate-x-full');
    setTimeout(() => {
        backdrop.classList.add('hidden');
        document.body.classList.remove('overflow-hidden');
    }, 300);
}

function formatTimeMxShort(dateStr) {
    return formatDateTimeMx(dateStr);
}

function renderUserExplorer(data) {
    const { user, summary = {}, sessions = [], events = [], orders = [] } = data;
    
    if (user.name) document.getElementById('ue-name').textContent = user.name;
    else document.getElementById('ue-name').textContent = 'User An\u00f3nimo';
    
    const stitchedText = Array.isArray(user.stitchedUserKeys) && user.stitchedUserKeys.length
        ? ' stitchedKeys: ' + user.stitchedUserKeys.length
        : '';
    document.getElementById('ue-email').textContent = (user.emailHash ? 'Email: ' + user.emailHash.substring(0,8) + '... | ' : '') + 'userKey: ' + user.userKey + stitchedText;

    const attribution = summary.attribution || {};
    const attributionRows = Object.entries(attribution)
        .sort((a, b) => Number(b[1]?.revenue || 0) - Number(a[1]?.revenue || 0))
        .slice(0, 4)
        .map(([channel, stats]) => {
            const rev = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'MXN' }).format(Number(stats?.revenue || 0));
            return '<p><strong>' + channel.toUpperCase() + ':</strong> ' + Number(stats?.orders || 0) + ' purchases · ' + rev + '</p>';
        })
        .join('');

    const summaryHtml =
        '<div class="grid grid-cols-2 gap-3 mb-5">' +
            '<div class="bg-white border border-gray-200 rounded-lg p-3"><p class="text-[11px] uppercase tracking-wide text-gray-500">Revenue</p><p class="text-sm font-semibold text-indigo-700">' + formatCurrency(Number(summary.totalRevenue || 0)) + '</p></div>' +
            '<div class="bg-white border border-gray-200 rounded-lg p-3"><p class="text-[11px] uppercase tracking-wide text-gray-500">Purchases</p><p class="text-sm font-semibold text-gray-900">' + Number(summary.totalOrders || 0) + '</p></div>' +
            '<div class="bg-white border border-gray-200 rounded-lg p-3"><p class="text-[11px] uppercase tracking-wide text-gray-500">Sessions</p><p class="text-sm font-semibold text-gray-900">' + Number(summary.totalSessions || 0) + '</p></div>' +
            '<div class="bg-white border border-gray-200 rounded-lg p-3"><p class="text-[11px] uppercase tracking-wide text-gray-500">Carts</p><p class="text-sm font-semibold text-gray-900">' + Number(summary.totalAddToCart || 0) + '</p></div>' +
            '<div class="bg-white border border-gray-200 rounded-lg p-3 col-span-2"><p class="text-[11px] uppercase tracking-wide text-gray-500">Stitched attribution</p>' +
                (attributionRows || '<p class="text-sm text-gray-500">No consolidated attribution yet.</p>') +
            '</div>' +
        '</div>';

    let html = summaryHtml + '<div class="relative border-l-2 border-indigo-100 ml-3 space-y-8 pb-10">';
    
    const timeline = [];
    
    sessions.forEach(s => {
        timeline.push({ type: 'session', time: new Date(s.startedAt), data: s });
    });
    events.forEach(e => {
        timeline.push({ type: 'event', time: new Date(e.createdAt), data: e });
    });
    orders.forEach(o => {
        timeline.push({ type: 'order', time: new Date(o.createdAt), data: o });
    });
    
    timeline.sort((a,b) => b.time - a.time);
    
    if (timeline.length === 0) {
        document.getElementById('ue-content').innerHTML = '<p class="text-gray-500">No events registered for this user.</p>';
        return;
    }

    timeline.forEach(item => {
        const timeStr = formatTimeMxShort(item.time);
        
        if (item.type === 'session') {
            const s = item.data;
            html += '<div class="relative pl-6">' +
                '<div class="absolute -left-2 top-1.5 p-1.5 rounded-full bg-indigo-500 border-4 border-gray-900 shadow-sm ring-1 ring-indigo-500/30"></div>' +
                '<p class="text-xs text-indigo-600 font-bold uppercase tracking-wider mb-1">' + timeStr + ' - Nueva Sesi\u00f3n</p>' +
                '<div class="bg-gray-50 rounded-lg p-3 text-sm text-gray-700 border border-gray-200">' +
                    '<p><strong>Source:</strong> ' + (s.utmSource || s.referrer || '(direct)') + ' / ' + (s.utmMedium || '(none)') + '</p>' +
                    (s.utmCampaign ? '<p><strong>Campa\u00f1a:</strong> ' + s.utmCampaign + '</p>' : '') +
                    (s.landingPageUrl ? '<p class="truncate"><strong>Landing:</strong> ' + s.landingPageUrl + '</p>' : '') +
                '</div>' +
            '</div>';
        } else if (item.type === 'order') {
            const o = item.data;
            const revStr = new Intl.NumberFormat('en-US', { style: 'currency', currency: o.currency || 'MXN' }).format(Number(o.revenue || 0));
            html += '<div class="relative pl-6">' +
                '<div class="absolute -left-2 top-1.5 p-1.5 rounded-full bg-emerald-500 border-4 border-gray-900 shadow-sm ring-1 ring-emerald-500/30"></div>' +
                '<p class="text-xs text-emerald-600 font-bold uppercase tracking-wider mb-1">' + timeStr + ' - Purchase (' + revStr + ')</p>' +
                '<div class="bg-gray-50 rounded-lg p-3 text-sm text-gray-800 border border-gray-200">' +
                    '<p><strong>Order:</strong> #' + (o.orderNumber || o.orderId) + '</p>' +
                    '<p><strong>Atribuci\u00f3n (\u00daltimo Clic):</strong> ' + humanReadableChannel(o.attributedChannel || 'unattributed', o.attributedPlatform || '') + '</p>' +
                '</div>' +
            '</div>';
        } else if (item.type === 'event') {
            const e = item.data;
            if (e.eventName.match(/page_view/i)) return; // Skip standard page views
            let evLabel = e.eventName;
            let evClass = 'text-gray-500';
            let evDot = 'bg-gray-300';
            if (e.eventName === 'add_to_cart') { evLabel = 'Agreg\u00f3 al carrito'; evClass = 'text-indigo-600 font-semibold'; evDot = 'bg-indigo-400'; }
            if (e.eventName === 'begin_checkout') { evLabel = 'Inici\u00f3 Checkout'; evClass = 'text-orange-600 font-semibold'; evDot = 'bg-orange-400'; }
            
            html += '<div class="relative pl-6">' +
                '<div class="absolute -left-[5px] top-2 w-2.5 h-2.5 rounded-full ' + evDot + ' ring-4 ring-gray-900"></div>' +
                '<p class="text-xs ' + evClass + ' mb-1">' + timeStr + ' - ' + evLabel + '</p>' +
            '</div>';
        }
    });
    
    html += '</div>';
    document.getElementById('ue-content').innerHTML = html;
}

    