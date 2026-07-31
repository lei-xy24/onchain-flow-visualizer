const LIVE_CHAINS = new Set(["eth", "bsc", "polygon"]);

const liveSearchForm = document.getElementById("live-search-form");
const liveChainSelect = document.getElementById("live-chain-select");
const liveSearchError = document.getElementById("live-search-error");

liveSearchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const chain = liveChainSelect.value;
  if (!LIVE_CHAINS.has(chain)) {
    showLiveSearchError("请选择 ETH、BSC 或 Polygon。");
    return;
  }
  openLiveResult(chain);
});

liveChainSelect.addEventListener("change", () => {
  liveSearchError.hidden = true;
});

document.querySelectorAll("[data-chain]").forEach((button) => {
  button.addEventListener("click", () => openLiveResult(button.dataset.chain));
});

function openLiveResult(chain) {
  const resultUrl = new URL("./live-result.html", location.href);
  resultUrl.searchParams.set("chain", chain);
  location.assign(resultUrl.href);
}

function showLiveSearchError(message) {
  liveSearchError.textContent = message;
  liveSearchError.hidden = false;
}
