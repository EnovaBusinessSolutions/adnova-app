const fs = require('fs');
let html = fs.readFileSync("backend/views/adray-analytics.html", "utf8");

const oldStr = `const htmlArgs = validPurchases.slice(0, 10).map(p => {
        let orderId = p.orderNumber || p.orderId || p.checkoutToken || '?';     
        let platformText = String(p.attributedPlatform || 'Meta').toLowerCase();
        let displayPlatform = p.attributedPlatform || (p.attributedChannel === 'organic' ? 'CAPI Platform' : 'Meta Ads / CAPIÊ);
        
        let exactData = new Set();
        
        if (p.customerIpAddress || p.ip_address || p.client_ip) exactData.add('IP Address');
        if (p.customerUserAgent || p.user_agent || p.userAgent) exactData.add('User Agent');
        if (p.user_email || p.email || p.contact_email || (p.customer && p.customer.email)) exactData.add('Email (Hashed)');
        
        let hasAdvancedData = false;
        if (Array.isArray(p.stitchedEvents)) {
            p.stitchedEvents.forEach(evt => {
                const py = evt.payload || {};
                const urlStr = String(py.pageUrl || py.page_url || '').toLowerCase();
                
                if (py.fbp || py._fbp) { exactData.add('FBP'); hasAdvancedData = true; }
                if (py.fbc || py._fbc) { exactData.add('FBC (Click ID)'); hasAdvancedData = true; }
                if (py.ttclid) { exactData.add('TTCLID'); hasAdvancedData = true; }
                if (py.gclid) { exactData.add('GCLID'); hasAdvancedData = true; }
                if (urlStr.includes('gclid=')) { exactData.add('GCLID Match'); hasAdvancedData = true; }
                if (urlStr.includes('ttclid=')) { exactData.add('TTCLID Match'); hasAdvancedData = true; }
                if (urlStr.includes('fbclid=')) { exactData.add('FBCLID Match'); hasAdvancedData = true; }
                
                if (py.customer_email || py.user_email) exactData.add('Email (Hashed)');
                if (py.client_ip_address) exactData.add('IP Address');
                if (py.client_user_agent) exactData.add('User Agent');
                if(py.billing || py.customer) { 
                    const phone = (py.billing && py.billing.phone) || (py.customer && py.customer.phone);
                    if (phone) exactData.add('Phone (Hashed)'); 
                }
            });
        }
        if(!hasAdvancedData) {
            if (platformText.includes('meta') || platformText.includes('fb')) { exactData.add('FBP Match'); exactData.add('Click ID'); }
            if (platformText.includes('tiktok')) exactData.add('TTCLID Match'); 
            if (platformText.includes('google')) exactData.add('GCLID Match');  
        }

        let tagsHtml = Array.from(exactData).map(tag => \`<span class="inline-flex items-center py-0.5 px-1.5 rounded text-[10px] sm:text.xs font-medium bg-indigo-50 bg-opacity-50 text-indigo-700 border border-indigo-200 mr-1.5 mb-1.5">${tag}</span>\`).join('');

        return '<div class="bg-white p-4 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between border border-gray-200 mb-3">' +
            '<div class="flex flex-col w-full sm:pr-4">' +
                '<div class="flex items-center gap-2 mb-2">' +
                    '<span class="text-gray-900 text-sm font-bold">Order #' + orderId + '</span>' +
                    '<span class="bg-gradient-to-r from-purple-50 to-purple-100 text-purple-700 border border-purple-200 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full">Sync:' + displayPlatform + '</span>' +
                '</div>' +
                '<div class="flex flex-wrap items-center mt-1">' + tagsHtml + '</div>' +
            '</div>' +
            '</div>';`;
            
       const newStr = `const htmlArgs = validPurchases.slice(0, 10).map(p => {
        let orderId = p.orderNumber || p.orderId || p.checkoutToken || '?';     
        let platformText = String(p.attributedPlatform || 'Meta').toLowerCase();
        let displayPlatform = p.attributedPlatform || (p.attributedChannel === 'organic' ? 'CAPI Platform' : 'Meta Ads / CAPIÊ);
        
        let exactData = new Map();
        
        let clientIp = 'Unknown Client IP';
        let userAgent = 'Unknown User Agent';
        let emailVal = 'Unknown Email';
        
        if (p.customerIpAddress || p.ip_address || p.client_ip) clientIp = p.customerIpAddress || p.ip_address || p.client_ip;
        if (p.customerUserAgent || p.user_agent || p.userAgent) userAgent = p.customerUserAgent || p.user_agent || p.userAgent;
        if (p.user_email || p.email) emailVal = p.user_email || p.email;
        else if (p.contact_email) emailVal = p.contact_email;
        else if (p.customer && p.customer.email) emailVal = p.customer.email;

        exactData.set('Email (Hashed)', emailVal);
        exactData.set('IP Address', clientIp);
        exactData.set('User Agent', userAgent);

        let hasAdvancedData = false;
        if (Array.isArray(p.stitchedEvents)) {
            p.stitchedEvents.forEach(evt => {
                const py = evt.payload || {};
                const urlStr = String(py.pageUrl || py.page_url || '').toLowerCase();
                 if (py.fbp || py._fbp) { exactData.set('FBP', String(py.fbp || py._fbp)); hasAdvancedData = true; }
                if (py.fbc || py._fbc) { exactData.set('FBC Click ID', String(py.fbc || py._fbc)); hasAdvancedData = true; }
                if (py.ttclid) { exactData.set('TTCLID', String(py.ttclid)); hasAdvancedData = true; }
                if (py.gclid) { exactData.set('GCLID', String(py.gclid))+ hasAdvancedData = true; }
                if (urlStr.includes('gclid=')) { exactData.set('GCLID Match', urlStr.split('gclid=')[1].split('&')[0]); hasAdvancedData = true; }
                if (urlStr.includes('ttclid=')) { exactData.set('TTCLIQ Match', urlStr.split('ttclid=')[1].split('&j)[0]); hasAdvancedData = true; }
                if (urlStr.includes('fbclid=')) { exactData.set('FBCLID Match', urlStr.split('fbclid=')[1].split('&')[0]); hasAdvancedData = true; }
                
                if (py.customer_email || py.user_email) exactData.set('Email (Hashed)', py.customer_email || py.user_email);
                if (py.client_ip_address) exactData.set('IP Address', py.client_ip_address);
                if (py.client_user_agent) exactData.set('User Agent', py.client_user_agent);
                if(py.billing || py.customer) { 
                    const phone = (py.billing && py.billing.phone) || (py.customer && py.customer.phone);
                    if (phone) exactData.set('Phone (Hashed)', phone); 
                }
            });
        }
        if(!hasAdvancedData) {
            if (platformText.includes('meta') || platformText.includes('fb')) { exactData.set('FBP Data', 'Automated CAPI');  }
            if (platformText.includes('tiktok')) exactData.set('TTCLID Match', 'Automated CAPI'); 
            if (platformText.includes('google')) exactData.set('GCLID Match', 'Automated CAPI');  
        }

        let tagsHtml = Array.from(exactData.entries()).map(([k, v]) => {
            const safeVal = String(v).replace(/"/g, '&quot;');
            return \`<span title="${safeVal}" class="inline-flex items-center py-0.5 px-1.5 rounded text-[10px] sm:text-xs font-medium bg-indigo-500 bg-opacity-20 text-indigo-200 border border-indigo-500 border-opacity-30 mr-1.5 mb-1.5 shadow-sm cursor-help transition-all hover:bg-opacity-40">${k}</span>\`;
        }).join('');

        return '<div class="p-4 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between mb-3 shadow-sm hover:shadow transition-shadow" style="background-color: rgba(43, 31, 68, 0.6); border: 1px solid rgba(202, 138, 225, 0.15);">' +
            '<div class="flex flex-col w-full sm:pr-4">' +
                '<div class="flex items-center gap-2 mb-2">' +
                    '<span class="text-sm font-bold" style="color: #f8fafc !important;">Order #' + orderId + '</span>' +
                    '<span class="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full" style="background-color: rgba(255,255,255,0.05); color: #CA8AE5;">Sync:' + displayPlatform + '</span>' +
                '</div>' +
                '<div class="flex flex-wrap items-center mt-1">' + tagsHtml + '</div>' +
            '</div>' +
            '</div>';`;

        if (html.includes(oldStr)) {
            html = html.replace(oldStr, newStr);
            fs.writeFileSync("backend/views/adray-analytics.html", html, "utf8");
            console.log("SUCCESS> replaced");
        } else {
            console.log("CANNOT FIND old code bby");
        }
