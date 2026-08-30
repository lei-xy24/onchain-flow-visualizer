(function configureBackend(global) {
  "use strict";

  // 这里只填写后端团队提供的公开接口地址，不要放任何 API Key。
  // 留空时对应页面使用 static-site 内置演示数据，便于纯前端联调。
  global.ONCHAIN_API_CONFIG = Object.freeze({
    overview: "",
    flow: "",
    liveTransfers: "",
    marketPrices: "https://api.coingecko.com/api/v3/simple/price",
  });
})(globalThis);
