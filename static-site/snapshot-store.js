(function () {
  "use strict";

  const INDEX_URL = "./data/snapshot-index.json";

  async function loadIndex() {
    const index = await fetchJson(`${INDEX_URL}?t=${Date.now()}`);
    if (!index.latest || !Array.isArray(index.snapshots) || !index.snapshots.length) throw new Error("暂无已发布的分析快照");
    return index;
  }

  async function loadSnapshot(index, requestedId) {
    const id = requestedId && index.snapshots.some((item) => item.id === requestedId) ? requestedId : index.latest;
    const entry = index.snapshots.find((item) => item.id === id);
    if (!entry) throw new Error(`找不到快照 ${id}`);
    const snapshot = await fetchJson(`${entry.file}?d=${encodeURIComponent(entry.digest || entry.id)}`);
    if (snapshot.status !== "published" || snapshot.snapshotId !== entry.id) throw new Error("快照发布状态或版本不一致");
    return snapshot;
  }

  function populateVersionSelect(select, index, currentId) {
    select.replaceChildren();
    index.snapshots.forEach((entry, position) => {
      const option = document.createElement("option");
      option.value = entry.id;
      option.textContent = `${position === 0 ? "最新 · " : ""}${formatSlot(entry.slotStart)} · ${entry.modeLabel}`;
      option.selected = entry.id === currentId;
      select.appendChild(option);
    });
  }

  function formatSlot(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "未知时间";
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
      timeZone: "Asia/Shanghai",
    }).format(date);
  }

  async function fetchJson(url) {
    const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`数据读取失败（HTTP ${response.status}）`);
    return response.json();
  }

  window.SocialRadarSnapshots = { loadIndex, loadSnapshot, populateVersionSelect, formatSlot };
})();
