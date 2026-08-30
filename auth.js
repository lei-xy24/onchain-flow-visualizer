(function initializeFrontendGate(global) {
  "use strict";

  const SESSION_KEY = "finsec-demo-session-v1";
  const SESSION_DURATION_MS = 8 * 60 * 60 * 1_000;
  const EXPECTED_CREDENTIAL_HASH =
    "fa394e68d8c3ef85295d647805b34dc1a8afe5986420baffd018451053081c48";
  const isLoginPage = /(?:^|\/)login\.html$/.test(global.location.pathname);

  const api = Object.freeze({
    getSafeReturnUrl,
    isAuthenticated,
    signIn,
    signOut,
  });
  global.FINSEC_AUTH = api;

  if (isLoginPage) return;

  if (!isAuthenticated()) {
    const loginUrl = new URL("./login.html", global.location.href);
    loginUrl.searchParams.set(
      "returnTo",
      `${global.location.pathname}${global.location.search}${global.location.hash}`,
    );
    global.location.replace(loginUrl.href);
    return;
  }

  document.documentElement.setAttribute("data-auth-ready", "true");
  if (document.documentElement.dataset.authShowLogout === "false") return;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installLogoutControl, {
      once: true,
    });
  } else {
    installLogoutControl();
  }

  async function signIn(username, password) {
    const credential = `${String(username || "").trim()}:${String(password || "")}`;
    const digest = await sha256Hex(credential);
    if (!constantTimeEqual(digest, EXPECTED_CREDENTIAL_HASH)) return false;

    const session = {
      expiresAt: Date.now() + SESSION_DURATION_MS,
      issuedAt: Date.now(),
      user: "admin",
    };
    try {
      global.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      return true;
    } catch {
      return false;
    }
  }

  function isAuthenticated() {
    try {
      const session = JSON.parse(global.sessionStorage.getItem(SESSION_KEY));
      if (
        session?.user !== "admin" ||
        !Number.isFinite(session?.expiresAt) ||
        session.expiresAt <= Date.now()
      ) {
        global.sessionStorage.removeItem(SESSION_KEY);
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  function signOut() {
    try {
      global.sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // 存储不可用时，仍继续跳回登录页。
    }
    global.location.replace(new URL("./login.html", global.location.href).href);
  }

  function getSafeReturnUrl(value) {
    const fallback = new URL("./index.html", global.location.href);
    if (!value) return fallback.href;

    try {
      const target = new URL(value, global.location.href);
      const siteDirectory = new URL("./", global.location.href).pathname;
      if (target.origin !== global.location.origin) return fallback.href;
      if (!target.pathname.startsWith(siteDirectory)) return fallback.href;
      if (/(?:^|\/)login\.html$/.test(target.pathname)) return fallback.href;
      return target.href;
    } catch {
      return fallback.href;
    }
  }

  function installLogoutControl() {
    if (document.querySelector("[data-auth-logout]")) return;

    const button = document.createElement("button");
    button.className = "auth-logout";
    button.dataset.authLogout = "";
    button.type = "button";
    button.innerHTML = '<span aria-hidden="true">↗</span><span>退出</span>';
    button.addEventListener("click", signOut);

    const monitorActions = document.querySelector(".monitor-actions");
    if (monitorActions) {
      monitorActions.append(button);
      return;
    }

    const navigation = document.querySelector(
      ".site-header .tool-nav, .radar-header .radar-nav, .story-header .story-nav",
    );
    if (navigation?.parentElement) {
      const wrapper = document.createElement("div");
      wrapper.className = "auth-header-actions";
      navigation.parentElement.insertBefore(wrapper, navigation);
      wrapper.append(navigation, button);
      return;
    }

    const appRoot = document.getElementById("app");
    if (appRoot && typeof MutationObserver === "function") {
      mountResultLogout();
      const observer = new MutationObserver(() => {
        mountResultLogout();
      });
      observer.observe(appRoot, { childList: true, subtree: true });
      return;
    }

    button.classList.add("auth-logout-floating");
    document.body.append(button);

    function mountResultLogout() {
      const resultActions = document.querySelector(
        ".result-header .header-actions",
      );
      if (resultActions) {
        if (button.parentElement === resultActions) return;
        button.classList.remove("auth-logout-floating");
        resultActions.append(button);
        return;
      }
      if (button.isConnected) return;
      button.classList.add("auth-logout-floating");
      document.body.append(button);
    }
  }

  async function sha256Hex(value) {
    if (!global.crypto?.subtle) {
      throw new Error("当前浏览器不支持安全登录校验");
    }
    const bytes = new TextEncoder().encode(value);
    const digest = await global.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  function constantTimeEqual(left, right) {
    if (left.length !== right.length) return false;
    let difference = 0;
    for (let index = 0; index < left.length; index += 1) {
      difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
    }
    return difference === 0;
  }
})(globalThis);
