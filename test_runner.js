const fs = require('fs');
let code = fs.readFileSync('test_live_pixel.js', 'utf8');

// Basic DOM Mock
global.window = {
  location: { search: "", href: "http://test.com", pathname: "/" },
  sessionStorage: { getItem: () => null, setItem: () => {} },
  localStorage: { getItem: () => null, setItem: () => {} },
  navigator: { userAgent: "mock", language: "en", sendBeacon: () => true },
  crypto: { randomUUID: () => '123-456' }
};

global.document = {
  cookie: "",
  querySelectorAll: (sel) => {
    return [{
      getAttribute: (attr) => "mock-account-id"
    }];
  },
  body: {
    classList: { contains: () => false }
  },
  referrer: ""
};

global.navigator = global.window.navigator;

global.XMLHttpRequest = function() { this.addEventListener = ()=>{}; }; global.XMLHttpRequest.prototype = { open: function(){} }; global.fetch = function(url, opts) {
  console.log("FETCH CALLED ->", url);
  console.log("PAYLOAD ->", Buffer.from(opts.body).toString('utf8') || opts.body);
  return Promise.resolve();
};

try {
  eval(code);
    console.log("EXECUTION COMPLETE. NO CRASHES.");
} catch(e) {
  console.error("EXECUTION CRASHED:", e);
}