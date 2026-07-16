const LIVE_CHAIN_ALIASES = new Map([
  ["eth", "eth"],
  ["ethereum", "eth"],
  ["以太坊", "eth"],
  ["bnb", "bsc"],
  ["bsc", "bsc"],
  ["bnb smart chain", "bsc"],
  ["binance smart chain", "bsc"],
  ["币安智能链", "bsc"],
  ["pol", "polygon"],
  ["matic", "polygon"],
  ["polygon", "polygon"],
  ["polygon pos", "polygon"],
]);

const liveSearchForm = document.getElementById("live-search-form");
const liveSearchInput = document.getElementById("asset-search-input");
const liveSearchError = document.getElementById("live-search-error");

liveSearchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const chain = normalizeLiveChain(liveSearchInput.value);
  if (!chain) {
    showLiveSearchError("目前支持 ETH、BNB/BSC 和 POL/Polygon。");
    return;
  }
  openLiveResult(chain);
});

liveSearchInput.addEventListener("input", () => {
  liveSearchError.hidden = true;
});

document.querySelectorAll("[data-chain]").forEach((button) => {
  button.addEventListener("click", () => openLiveResult(button.dataset.chain));
});

function normalizeLiveChain(value) {
  return LIVE_CHAIN_ALIASES.get(value.trim().toLowerCase()) || null;
}

function openLiveResult(chain) {
  const resultUrl = new URL("./live-result.html", location.href);
  resultUrl.searchParams.set("chain", chain);
  location.assign(resultUrl.href);
}

function showLiveSearchError(message) {
  liveSearchError.textContent = message;
  liveSearchError.hidden = false;
}
