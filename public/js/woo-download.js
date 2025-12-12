/**
 * WooCommerce Plugin Download Page JavaScript
 */

document.addEventListener('DOMContentLoaded', async function () {
    try {
        const res = await fetch('/api/plugin/info');
        const data = await res.json();

        if (data.ok && data.plugin) {
            document.getElementById('version').textContent = 'v' + data.plugin.version;
        }
    } catch (err) {
        console.log('Could not fetch plugin info:', err);
    }
});
