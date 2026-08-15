const SEARCH_HISTORY_STORAGE_KEY = "onchain-flow-search-history-v1";
const SEARCH_HISTORY_LIMIT = 10;
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const EXAMPLE_ADDRESSES = Object.freeze({
  eth: "0x4838B106FCe9647Bdf1E7877BF73cE8B0BAD5f97",
  bsc: "0xB5C0000000000000000000000000000000000001",
  polygon: "0x9000000000000000000000000000000000000001",
});
const CHAIN_LABELS = Object.freeze({
  eth: "ETH",
  bsc: "BSC",
  polygon: "Polygon",
});

const form = document.getElementById("search-form");
const chainSelect = document.getElementById("chain-select");
const addressInput = document.getElementById("address-search");
const error = document.getElementById("form-error");
const historyPanel = document.getElementById("search-history");
const historyList = document.getElementById("history-list");
const historyEmpty = document.getElementById("history-empty");
const clearHistoryButton = document.getElementById("clear-history");

let historyEntries = readHistory();
let inputHasChanged = false;

form.addEventListener("submit", (event) => {
  event.preventDefault();
  openResult(chainSelect.value, addressInput.value);
});

chainSelect.addEventListener("change", () => {
  addressInput.value = EXAMPLE_ADDRESSES[chainSelect.value] || "";
  inputHasChanged = false;
  error.hidden = true;
  renderHistory("");
});

addressInput.addEventListener("focus", () => {
  renderHistory(inputHasChanged ? addressInput.value : "");
  setHistoryOpen(true);
});

addressInput.addEventListener("input", () => {
  inputHasChanged = true;
  error.hidden = true;
  renderHistory(addressInput.value);
  setHistoryOpen(true);
});

addressInput.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (historyPanel.hidden) {
      renderHistory(inputHasChanged ? addressInput.value : "");
      setHistoryOpen(true);
    }
    historyList.querySelector(".history-query")?.focus();
  } else if (event.key === "Escape") {
    setHistoryOpen(false);
  }
});

historyList.addEventListener("keydown", (event) => {
  const queryButtons = Array.from(
    historyList.querySelectorAll(".history-query"),
  );
  const currentIndex = queryButtons.indexOf(document.activeElement);
  if (event.key === "ArrowDown" && currentIndex >= 0) {
    event.preventDefault();
    queryButtons[(currentIndex + 1) % queryButtons.length]?.focus();
  } else if (event.key === "ArrowUp" && currentIndex >= 0) {
    event.preventDefault();
    queryButtons[
      (currentIndex - 1 + queryButtons.length) % queryButtons.length
    ]?.focus();
  } else if (event.key === "Escape") {
    event.preventDefault();
    addressInput.focus();
    setHistoryOpen(false);
  }
});

clearHistoryButton.addEventListener("click", () => {
  historyEntries = [];
  writeHistory();
  renderHistory(addressInput.value);
  addressInput.focus();
});

document.querySelectorAll("[data-address]").forEach((button) => {
  button.addEventListener("click", () => {
    openResult(button.dataset.chain, button.dataset.address);
  });
});

document.addEventListener("pointerdown", (event) => {
  if (!form.contains(event.target)) setHistoryOpen(false);
});

form.addEventListener("focusout", () => {
  window.setTimeout(() => {
    if (!form.contains(document.activeElement)) setHistoryOpen(false);
  }, 0);
});

function openResult(chain, address) {
  const cleaned = String(address || "").trim();
  if (!EXAMPLE_ADDRESSES[chain]) {
    showError("请选择受支持的链。");
    return;
  }
  if (!EVM_ADDRESS_PATTERN.test(cleaned)) {
    showError("请输入有效的 EVM 地址（0x 加 40 位十六进制字符）。");
    return;
  }

  rememberSearch(chain, cleaned);
  setHistoryOpen(false);
  const resultUrl = new URL("./result.html", location.href);
  resultUrl.searchParams.set("chain", chain);
  resultUrl.searchParams.set("address", cleaned);
  location.assign(resultUrl.href);
}

function rememberSearch(chain, address) {
  const normalizedAddress = address.toLowerCase();
  historyEntries = [
    { chain, address, searchedAt: Date.now() },
    ...historyEntries.filter(
      (item) =>
        item.chain !== chain ||
        item.address.toLowerCase() !== normalizedAddress,
    ),
  ].slice(0, SEARCH_HISTORY_LIMIT);
  writeHistory();
}

function readHistory() {
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY) || "[]",
    );
    if (!Array.isArray(stored)) return [];
    return stored
      .filter(
        (item) =>
          item &&
          EXAMPLE_ADDRESSES[item.chain] &&
          EVM_ADDRESS_PATTERN.test(String(item.address || "")),
      )
      .map((item) => ({
        chain: item.chain,
        address: String(item.address),
        searchedAt: Number(item.searchedAt) || 0,
      }))
      .sort((a, b) => b.searchedAt - a.searchedAt)
      .slice(0, SEARCH_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function writeHistory() {
  try {
    if (historyEntries.length) {
      window.localStorage.setItem(
        SEARCH_HISTORY_STORAGE_KEY,
        JSON.stringify(historyEntries),
      );
    } else {
      window.localStorage.removeItem(SEARCH_HISTORY_STORAGE_KEY);
    }
  } catch {
    // Private browsing or storage policies can disable localStorage.
  }
}

function renderHistory(filterValue) {
  const query = String(filterValue || "").trim().toLowerCase();
  const visibleEntries = historyEntries.filter((item) => {
    if (!query) return true;
    return (
      item.address.toLowerCase().includes(query) ||
      CHAIN_LABELS[item.chain].toLowerCase().includes(query)
    );
  });

  historyList.replaceChildren();
  clearHistoryButton.hidden = historyEntries.length === 0;
  historyEmpty.hidden = visibleEntries.length > 0;

  if (!visibleEntries.length) {
    historyEmpty.textContent = historyEntries.length
      ? "没有匹配的历史记录"
      : "暂无搜索记录，完成一次地址查询后会显示在这里";
    return;
  }

  visibleEntries.forEach((item) => {
    const listItem = document.createElement("li");
    listItem.className = "history-item";

    const queryButton = document.createElement("button");
    queryButton.className = "history-query";
    queryButton.type = "button";
    queryButton.title = `重新搜索 ${item.address}`;

    const chainBadge = document.createElement("span");
    chainBadge.className = "history-chain";
    chainBadge.textContent = CHAIN_LABELS[item.chain];

    const addressLabel = document.createElement("span");
    addressLabel.className = "history-address";
    addressLabel.textContent = item.address;

    const timeLabel = document.createElement("span");
    timeLabel.className = "history-time";
    timeLabel.textContent = formatHistoryTime(item.searchedAt);

    const reuseLabel = document.createElement("span");
    reuseLabel.className = "history-reuse";
    reuseLabel.textContent = "再次搜索";

    queryButton.append(chainBadge, addressLabel, timeLabel, reuseLabel);
    queryButton.addEventListener("click", () => {
      chainSelect.value = item.chain;
      addressInput.value = item.address;
      openResult(item.chain, item.address);
    });

    const removeButton = document.createElement("button");
    removeButton.className = "history-remove";
    removeButton.type = "button";
    removeButton.setAttribute(
      "aria-label",
      `删除 ${CHAIN_LABELS[item.chain]} ${shortAddress(item.address)} 的搜索记录`,
    );
    removeButton.textContent = "×";
    removeButton.addEventListener("click", () => {
      historyEntries = historyEntries.filter(
        (entry) =>
          entry.chain !== item.chain ||
          entry.address.toLowerCase() !== item.address.toLowerCase(),
      );
      writeHistory();
      renderHistory(addressInput.value);
      addressInput.focus();
    });

    listItem.append(queryButton, removeButton);
    historyList.append(listItem);
  });
}

function setHistoryOpen(isOpen) {
  historyPanel.hidden = !isOpen;
  addressInput.setAttribute("aria-expanded", String(isOpen));
}

function formatHistoryTime(timestamp) {
  if (!timestamp) return "较早";
  const elapsed = Date.now() - timestamp;
  if (elapsed < 60_000) return "刚刚";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`;

  const date = new Date(timestamp);
  const now = new Date();
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
  }
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function shortAddress(address) {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function showError(message) {
  error.textContent = message;
  error.hidden = false;
}
