const ADDRESS_HISTORY_STORAGE_KEY = "onchain-flow-search-history-v1";
const ADDRESS_HISTORY_LIMIT = 10;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const CHAIN_LABELS = Object.freeze({
  eth: "ETH",
  bsc: "BSC",
  polygon: "Polygon",
});

export function createAddressHistory({
  input,
  chainSelect,
  panel,
  onSelect,
}) {
  const list = panel.querySelector("[data-history-list]");
  const empty = panel.querySelector("[data-history-empty]");
  const clearButton = panel.querySelector("[data-history-clear]");
  let inputHasChanged = false;
  let resizeFrame = 0;

  input.setAttribute("aria-controls", panel.id);
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-haspopup", "dialog");

  input.addEventListener("focus", () => {
    render(inputHasChanged ? input.value : "");
    setOpen(true);
  });

  input.addEventListener("input", () => {
    inputHasChanged = true;
    render(input.value);
    setOpen(true);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (panel.hidden) {
        render(inputHasChanged ? input.value : "");
        setOpen(true);
      }
      list.querySelector(".history-query")?.focus();
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  });

  list.addEventListener("keydown", (event) => {
    const queryButtons = Array.from(list.querySelectorAll(".history-query"));
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
      input.focus();
      setOpen(false);
    }
  });

  clearButton.addEventListener("click", () => {
    writeHistory([]);
    render(input.value);
    input.focus();
  });

  document.addEventListener("pointerdown", (event) => {
    if (!panel.parentElement.contains(event.target)) setOpen(false);
  });

  panel.parentElement.addEventListener("focusout", () => {
    window.setTimeout(() => {
      if (!panel.parentElement.contains(document.activeElement)) setOpen(false);
    }, 0);
  });

  window.addEventListener("resize", () => {
    if (panel.hidden) return;
    window.cancelAnimationFrame(resizeFrame);
    resizeFrame = window.requestAnimationFrame(positionWithinViewport);
  });

  function render(filterValue = "") {
    const entries = readHistory();
    const query = String(filterValue).trim().toLowerCase();
    const visibleEntries = entries.filter((entry) => {
      if (!query) return true;
      return (
        entry.address.toLowerCase().includes(query) ||
        CHAIN_LABELS[entry.chain].toLowerCase().includes(query)
      );
    });

    list.replaceChildren();
    clearButton.hidden = entries.length === 0;
    empty.hidden = visibleEntries.length > 0;

    if (!visibleEntries.length) {
      empty.textContent = entries.length
        ? "没有匹配的历史记录"
        : "暂无搜索记录，完成一次地址查询后会显示在这里";
      return;
    }

    visibleEntries.forEach((entry) => {
      const item = document.createElement("li");
      item.className = "history-item";

      const queryButton = document.createElement("button");
      queryButton.className = "history-query";
      queryButton.type = "button";
      queryButton.title = `使用 ${entry.address}`;

      const chainBadge = document.createElement("span");
      chainBadge.className = "history-chain";
      chainBadge.textContent = CHAIN_LABELS[entry.chain];

      const addressLabel = document.createElement("span");
      addressLabel.className = "history-address";
      addressLabel.textContent = entry.address;

      const timeLabel = document.createElement("span");
      timeLabel.className = "history-time";
      timeLabel.textContent = formatHistoryTime(entry.searchedAt);

      const reuseLabel = document.createElement("span");
      reuseLabel.className = "history-reuse";
      reuseLabel.textContent = "使用";

      queryButton.append(chainBadge, addressLabel, timeLabel, reuseLabel);
      queryButton.addEventListener("click", () => {
        chainSelect.value = entry.chain;
        input.value = entry.address;
        inputHasChanged = false;
        rememberAddressSearch(entry.chain, entry.address);
        input.focus({ preventScroll: true });
        setOpen(false);
        onSelect?.(entry);
      });

      const removeButton = document.createElement("button");
      removeButton.className = "history-remove";
      removeButton.type = "button";
      removeButton.setAttribute(
        "aria-label",
        `删除 ${CHAIN_LABELS[entry.chain]} ${shortAddress(entry.address)} 的搜索记录`,
      );
      removeButton.textContent = "×";
      removeButton.addEventListener("click", () => {
        const nextEntries = readHistory().filter(
          (candidate) =>
            candidate.chain !== entry.chain ||
            candidate.address.toLowerCase() !== entry.address.toLowerCase(),
        );
        writeHistory(nextEntries);
        render(input.value);
        input.focus();
      });

      item.append(queryButton, removeButton);
      list.append(item);
    });
  }

  function setOpen(isOpen) {
    panel.hidden = !isOpen;
    input.setAttribute("aria-expanded", String(isOpen));
    if (isOpen) positionWithinViewport();
  }

  function positionWithinViewport() {
    const viewportPadding = 12;
    const viewportWidth = document.documentElement.clientWidth;
    panel.style.setProperty("--history-offset-x", "0px");

    const panelRect = panel.getBoundingClientRect();
    let offsetX = 0;
    if (panelRect.right > viewportWidth - viewportPadding) {
      offsetX -= panelRect.right - (viewportWidth - viewportPadding);
    }
    if (panelRect.left + offsetX < viewportPadding) {
      offsetX += viewportPadding - (panelRect.left + offsetX);
    }
    panel.style.setProperty("--history-offset-x", `${offsetX}px`);
  }

  return {
    close: () => setOpen(false),
    refresh: () => render(inputHasChanged ? input.value : ""),
    resetInputState() {
      inputHasChanged = false;
      setOpen(false);
    },
  };
}

export function rememberAddressSearch(chain, address) {
  const cleaned = String(address || "").trim();
  if (!CHAIN_LABELS[chain] || !ADDRESS_PATTERN.test(cleaned)) return;

  const normalizedAddress = cleaned.toLowerCase();
  const entries = [
    { chain, address: cleaned, searchedAt: Date.now() },
    ...readHistory().filter(
      (entry) =>
        entry.chain !== chain ||
        entry.address.toLowerCase() !== normalizedAddress,
    ),
  ].slice(0, ADDRESS_HISTORY_LIMIT);
  writeHistory(entries);
}

function readHistory() {
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(ADDRESS_HISTORY_STORAGE_KEY) || "[]",
    );
    if (!Array.isArray(stored)) return [];
    const deduplicated = new Map();
    stored
      .filter(
        (entry) =>
          entry &&
          CHAIN_LABELS[entry.chain] &&
          ADDRESS_PATTERN.test(String(entry.address || "")),
      )
      .sort((a, b) => Number(b.searchedAt || 0) - Number(a.searchedAt || 0))
      .forEach((entry) => {
        const key = `${entry.chain}:${String(entry.address).toLowerCase()}`;
        if (!deduplicated.has(key)) {
          deduplicated.set(key, {
            chain: entry.chain,
            address: String(entry.address),
            searchedAt: Number(entry.searchedAt) || 0,
          });
        }
      });
    return [...deduplicated.values()].slice(0, ADDRESS_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function writeHistory(entries) {
  try {
    if (entries.length) {
      window.localStorage.setItem(
        ADDRESS_HISTORY_STORAGE_KEY,
        JSON.stringify(entries.slice(0, ADDRESS_HISTORY_LIMIT)),
      );
    } else {
      window.localStorage.removeItem(ADDRESS_HISTORY_STORAGE_KEY);
    }
  } catch {
    // Browser privacy settings can disable localStorage.
  }
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
