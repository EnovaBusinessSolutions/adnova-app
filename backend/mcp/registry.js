'use strict';

const toolModules = [
  require('./tools/get_account_info'),
  require('./tools/get_ad_performance'),
  require('./tools/get_campaign_performance'),
  require('./tools/get_adset_performance'),
  require('./tools/get_shopify_revenue'),
  require('./tools/get_shopify_products'),
  require('./tools/get_channel_summary'),
  require('./tools/get_date_comparison'),
];

function registerAllTools(server) {
  for (const mod of toolModules) {
    if (typeof mod.register === 'function') {
      mod.register(server);
    }
  }
}

module.exports = { registerAllTools, toolModules };
