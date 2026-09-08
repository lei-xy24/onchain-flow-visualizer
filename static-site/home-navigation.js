(() => {
  // Keep the original overview data on the homepage; module links reveal it in place.
  function revealSection(hash) {
    const section = document.getElementById(hash.slice(1));
    if (section?.tagName === "DETAILS" && section.closest(".home-shell")) {
      section.open = true;
    }
  }

  document.querySelectorAll('.home-shell a[href^="#"]').forEach((link) => {
    link.addEventListener("click", () => revealSection(link.getAttribute("href")));
  });
  window.addEventListener("hashchange", () => revealSection(window.location.hash));
  revealSection(window.location.hash);
})();
