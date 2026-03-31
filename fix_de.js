const fs = require('fs'); let html = fs.readFileSync('backend/views/adray-analytics.html', 'utf8'); let newContent = \unction renderDataEnrichment(purchases) {
    console.log('[Data Enrichment] Received purchases data to render:', purchases);
    const list = document.getElementById('de-payload-list');
    if (!list) {
        console.warn('[Data Enrichment] de-payload-list DOM element not found');
        return;
    }
    const toggle = document.getElementById('de-toggle');
    if (toggle && !toggle.checked) {
        console.log('[Data Enrichment] Panel is toggled off, ignoring render');
        return;
    }
    if (!Array.isArray(purchases) || purchases.length === 0) {
        console.log('[Data Enrichment] No purchases array found or array is empty.');
        list.innerHTML = '<p class=\"text-sm text-gray-400\">No recent enrichment events found.</p>';
        return;
    }
    
    // Fallback filter to remove purely malformed empty objects without orderNumber or orderId
    const validPurchases = purchases.filter(p => {
        const isValid = p.orderNumber || p.orderId || p.checkoutToken || p._id || p.id;
        if (!isValid) console.warn('[Data Enrichment] Filtering out malformed purchase without ID:', p);
        return isValid;
    });

    console.log('[Data Enrichment] Valid purchases to display:', validPurchases.length);
\; html = html.replace(/function renderDataEnrichment\\(purchases\\) \\{[\\s\\S]*?const validPurchases = purchases\\.filter\\(p => Number\\(p\\.revenue \\|\\| 0\\) > 0\\);/, newContent); fs.writeFileSync('backend/views/adray-analytics.html', html);
