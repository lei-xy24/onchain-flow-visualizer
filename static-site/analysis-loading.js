export function createAnalysisLoading({
  title,
  description,
  steps,
  onCancel,
}) {
  const overlay = document.createElement("div");
  overlay.className = "analysis-loading-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `
    <header class="analysis-loading-topbar">
      <button class="analysis-loading-back" type="button">← 返回查询</button>
      <span class="analysis-loading-security">安全查询通道</span>
    </header>
    <main class="analysis-loading-layout" role="status" aria-live="polite">
      <section class="analysis-loading-copy">
        <p class="section-kicker">Onchain data analysis</p>
        <div class="analysis-loading-heading">
          <div class="analysis-loading-orbit" aria-hidden="true"></div>
          <div>
            <h1></h1>
            <p></p>
          </div>
        </div>
        <div class="analysis-loading-queries" aria-label="当前查询条件"></div>
        <ol class="analysis-loading-steps" aria-label="数据加载进度"></ol>
      </section>
      <section class="analysis-loading-preview" aria-hidden="true">
        <div class="analysis-loading-preview-bar"><span></span><span></span><span></span></div>
        <div class="analysis-loading-preview-body">
          <div class="analysis-loading-skeleton analysis-loading-skeleton-title"></div>
          <div class="analysis-loading-network">
            <span class="analysis-loading-node node-top"></span>
            <span class="analysis-loading-node node-left"></span>
            <span class="analysis-loading-node node-center"></span>
            <span class="analysis-loading-node node-right"></span>
            <span class="analysis-loading-node node-bottom"></span>
          </div>
          <div class="analysis-loading-card-grid">
            <span></span><span></span><span></span>
          </div>
        </div>
      </section>
    </main>`;

  const heading = overlay.querySelector(".analysis-loading-heading h1");
  const copy = overlay.querySelector(".analysis-loading-heading p");
  const backButton = overlay.querySelector(".analysis-loading-back");
  const queries = overlay.querySelector(".analysis-loading-queries");
  const stepList = overlay.querySelector(".analysis-loading-steps");
  heading.textContent = title;
  copy.textContent = description;

  steps.forEach((step, index) => {
    const item = document.createElement("li");
    item.className = "analysis-loading-step";
    item.dataset.loadingStep = String(index + 1);

    const number = document.createElement("span");
    number.textContent = String(index + 1);
    const content = document.createElement("div");
    const label = document.createElement("strong");
    label.textContent = step.title;
    const detail = document.createElement("small");
    detail.textContent = step.detail;
    content.append(label, detail);
    item.append(number, content);
    stepList.append(item);
  });

  document.body.append(overlay);
  backButton.addEventListener("click", () => onCancel?.());

  function show(queryItems) {
    queries.replaceChildren();
    queryItems.forEach((item) => {
      const row = document.createElement("div");
      const label = document.createElement("span");
      label.textContent = item.label;
      const value = document.createElement("code");
      value.textContent = item.value;
      value.title = item.value;
      row.append(label, value);
      queries.append(row);
    });
    setStep(1);
    overlay.hidden = false;
    overlay.setAttribute("aria-busy", "true");
    document.body.classList.add("analysis-is-loading");
  }

  function setStep(stepNumber) {
    stepList.querySelectorAll("[data-loading-step]").forEach((item) => {
      const currentStep = Number(item.dataset.loadingStep);
      item.classList.toggle("is-active", currentStep === stepNumber);
      item.classList.toggle("is-done", currentStep < stepNumber);
    });
  }

  function hide() {
    overlay.hidden = true;
    overlay.removeAttribute("aria-busy");
    document.body.classList.remove("analysis-is-loading");
  }

  return { hide, setStep, show };
}
