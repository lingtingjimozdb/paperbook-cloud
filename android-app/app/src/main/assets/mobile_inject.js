(function () {
  if (window.__paperbookAndroidInjected) return;
  window.__paperbookAndroidInjected = true;
  document.documentElement.classList.add("paperbook-android");

  const style = document.createElement("style");
  style.id = "paperbookAndroidStyle";
  style.textContent = `
    html, body {
      overscroll-behavior: none;
      -webkit-tap-highlight-color: transparent;
    }

    body { padding-bottom: 0 !important; }

    #pbAndroidNav {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      height: calc(66px + env(safe-area-inset-bottom));
      padding: 7px 8px calc(7px + env(safe-area-inset-bottom));
      display: none;
      grid-template-columns: repeat(4, 1fr);
      gap: 6px;
      z-index: 10000;
      background: var(--panel, #fff);
      border-top: 1px solid var(--line, #ddd);
      box-shadow: 0 -8px 24px rgba(0,0,0,.08);
    }

    #pbAndroidNav.show { display: grid; }

    #pbAndroidNav button {
      min-width: 0;
      height: 48px;
      padding: 4px 2px;
      border-radius: 12px;
      font-size: 12px;
      line-height: 1.15;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      touch-action: manipulation;
    }

    #pbAndroidNav button span {
      font-size: 20px;
      line-height: 1;
    }

    #pbAndroidNav button.active {
      background: var(--soft, #e8f1ed);
      color: var(--accent, #2f6555);
      border-color: var(--accent, #2f6555);
      font-weight: 700;
    }

    @media (max-width: 1200px) {
      .app {
        display: block !important;
        height: 100dvh !important;
        min-height: 100dvh !important;
        overflow: hidden !important;
        padding-bottom: calc(66px + env(safe-area-inset-bottom));
      }

      .sidebar, .page-panel, .main {
        position: fixed !important;
        inset: 0 0 calc(66px + env(safe-area-inset-bottom)) 0 !important;
        width: 100% !important;
        max-width: none !important;
        max-height: none !important;
        min-height: 0 !important;
        border: 0 !important;
        display: none !important;
        background: var(--panel, #fff);
      }

      body[data-pbtab="books"] .sidebar { display: flex !important; }
      body[data-pbtab="pages"] .page-panel { display: flex !important; }
      body[data-pbtab="editor"] .main { display: flex !important; }

      .sidebar-head {
        padding: 14px 16px 9px !important;
        min-height: 62px;
      }

      .brand.small { font-size: 23px !important; }
      .user-card { padding: 8px 16px 13px !important; }
      .user-email { font-size: 16px !important; }
      .sync-status { font-size: 13px !important; }

      .button-row {
        padding: 11px 12px !important;
        gap: 8px !important;
      }

      button {
        min-height: 42px;
        touch-action: manipulation;
      }

      .button-row button {
        font-size: 16px;
        padding: 9px 13px;
      }

      .section-title {
        padding: 9px 15px 6px !important;
        font-size: 14px !important;
      }

      .list {
        padding: 4px 11px 14px !important;
        -webkit-overflow-scrolling: touch;
      }

      .item {
        min-height: 54px;
        margin: 4px 0 !important;
        padding: 12px !important;
        font-size: 17px;
        border-radius: 12px !important;
      }

      .badge { font-size: 13px !important; }

      .sidebar-footer {
        padding: 9px 12px 12px !important;
        gap: 7px !important;
      }

      .sidebar-footer button {
        min-height: 46px;
        font-size: 15px;
      }

      .search-wrap { padding: 9px 12px !important; }
      .search-wrap input {
        height: 48px;
        font-size: 16px;
      }

      .topbar {
        min-height: 62px;
        padding: 8px !important;
        overflow-x: auto;
        white-space: nowrap;
        flex-shrink: 0;
        -webkit-overflow-scrolling: touch;
      }

      .topbar button {
        flex: 0 0 auto;
        min-height: 44px;
        font-size: 15px;
      }

      #pageCounter { display: none; }

      .workspace {
        flex: 1;
        padding: 8px !important;
        -webkit-overflow-scrolling: touch;
      }

      .paper {
        max-width: none !important;
        width: 100% !important;
        min-height: calc(100dvh - 202px) !important;
        margin: 0 !important;
        padding: 17px 14px 40px !important;
        border-radius: 13px !important;
        box-shadow: none !important;
      }

      .title-input {
        font-size: 23px !important;
        min-height: 52px;
      }

      .tags-input {
        min-height: 46px;
        font-size: 15px;
      }

      .formatbar {
        overflow-x: auto;
        flex-wrap: nowrap !important;
        padding: 7px !important;
        -webkit-overflow-scrolling: touch;
      }

      .formatbar button {
        flex: 0 0 auto;
        min-width: 43px !important;
        min-height: 42px;
      }

      .editor {
        min-height: calc(100dvh - 350px) !important;
        font-size: 17px !important;
        line-height: 1.75 !important;
        padding: 14px 2px 40px !important;
      }

      .bottom {
        min-height: 58px;
        padding: 7px 8px !important;
        flex-shrink: 0;
        overflow-x: auto;
      }

      .page-numbers {
        min-width: 120px;
        justify-content: flex-start !important;
      }

      #jumpInput, #jumpBtn { display: none; }

      .toast {
        top: 10px !important;
        left: 10px !important;
        right: 10px !important;
        text-align: center;
        font-size: 14px;
      }

      dialog {
        width: calc(100vw - 28px) !important;
        max-width: none !important;
      }

      .auth-screen {
        min-height: 100dvh !important;
        padding: 18px !important;
      }

      .auth-card {
        padding: 23px 20px !important;
        border-radius: 18px !important;
      }

      .auth-card .brand { font-size: 27px !important; }
      .auth-card input { min-height: 50px; font-size: 16px; }
      .auth-card button { min-height: 48px; font-size: 16px; }
    }
  `;
  document.head.appendChild(style);

  const nav = document.createElement("nav");
  nav.id = "pbAndroidNav";
  nav.setAttribute("aria-label", "手机导航");
  nav.innerHTML = `
    <button type="button" data-tab="books"><span>📚</span>笔记本</button>
    <button type="button" data-tab="pages"><span>📄</span>页面</button>
    <button type="button" data-tab="editor"><span>✍️</span>编辑</button>
    <button type="button" data-action="reload"><span>↻</span>刷新</button>
  `;
  document.body.appendChild(nav);

  function setTab(tab) {
    document.body.dataset.pbtab = tab;
    nav.querySelectorAll("[data-tab]").forEach(button => {
      button.classList.toggle("active", button.dataset.tab === tab);
    });
  }

  window.__paperbookSetAndroidTab = setTab;

  window.__paperbookAppendScanText = function (title, text) {
    const titleInput = document.getElementById("titleInput");
    const editor = document.getElementById("editor");
    if (!titleInput || !editor) return false;

    const safeTitle = String(title || "扫描文字");
    const safeText = String(text || "").trim();

    if (!titleInput.value || titleInput.value === "第一页" || titleInput.value === "无标题页") {
      titleInput.value = safeTitle;
      titleInput.dispatchEvent(new Event("input", { bubbles: true }));
    }

    const section = document.createElement("section");
    section.className = "paperbook-scan-block";
    section.style.margin = "18px 0";
    section.style.padding = "13px";
    section.style.border = "1px solid var(--line, #ddd)";
    section.style.borderRadius = "10px";
    section.style.background = "var(--soft, #f3f7f5)";

    const heading = document.createElement("h2");
    heading.textContent = safeTitle;
    heading.style.margin = "0 0 10px";
    heading.style.fontSize = "18px";

    const body = document.createElement("div");
    body.style.whiteSpace = "pre-wrap";
    body.style.lineHeight = "1.8";
    body.textContent = safeText || "（未识别到文字）";

    section.appendChild(heading);
    section.appendChild(body);
    editor.appendChild(section);
    editor.appendChild(document.createElement("p"));
    editor.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: safeText
    }));

    if (window.__paperbookSetAndroidTab) {
      window.__paperbookSetAndroidTab("editor");
    }
    editor.scrollIntoView({ behavior: "smooth", block: "start" });
    return true;
  };


  nav.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.tab) setTab(button.dataset.tab);
    if (button.dataset.action === "reload") location.reload();
  });

  document.addEventListener("click", event => {
    if (event.target.closest("#notebookList .item")) {
      setTimeout(() => setTab("pages"), 80);
    }
    if (event.target.closest("#pageList .item")) {
      setTimeout(() => setTab("editor"), 80);
    }
    if (event.target.closest("#newPageBtn")) {
      setTimeout(() => setTab("editor"), 160);
    }
  }, true);

  function syncNavVisibility() {
    const app = document.getElementById("app");
    const visible = app && !app.classList.contains("hidden");
    nav.classList.toggle("show", Boolean(visible));
    if (visible && !document.body.dataset.pbtab) setTab("books");
    if (window.AndroidBridge && typeof window.AndroidBridge.setScannerVisible === "function") {
      window.AndroidBridge.setScannerVisible(Boolean(visible));
    }
  }

  new MutationObserver(syncNavVisibility).observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ["class"]
  });

  window.__paperbookAndroidBack = function () {
    const tab = document.body.dataset.pbtab;
    if (tab === "editor") {
      setTab("pages");
      return true;
    }
    if (tab === "pages") {
      setTab("books");
      return true;
    }
    return false;
  };

  // 让网页“导出备份”的 blob 文件可以保存到安卓下载目录。
  const originalAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    const anchor = this;
    if (
      anchor.download &&
      anchor.href &&
      anchor.href.startsWith("blob:") &&
      window.AndroidBridge &&
      typeof window.AndroidBridge.saveDataUrl === "function"
    ) {
      fetch(anchor.href)
        .then(response => response.blob())
        .then(blob => {
          const reader = new FileReader();
          reader.onloadend = () => {
            window.AndroidBridge.saveDataUrl(
              anchor.download || "PaperBook_备份.json",
              String(reader.result || ""),
              blob.type || "application/octet-stream"
            );
          };
          reader.readAsDataURL(blob);
        })
        .catch(() => originalAnchorClick.call(anchor));
      return;
    }
    return originalAnchorClick.apply(anchor, arguments);
  };

  syncNavVisibility();
})();
