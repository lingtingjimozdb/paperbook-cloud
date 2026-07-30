(function () {
  if (window.__paperbookAndroidInjected) return;
  window.__paperbookAndroidInjected = true;
  document.documentElement.classList.add("paperbook-android");

  window.__paperbookAppendScanText = function (title, text) {
    const titleInput = document.getElementById("titleInput");
    const editor = document.getElementById("editor");
    if (!titleInput || !editor) return false;

    const safeTitle = String(title || "扫描文字");
    const safeText = String(text || "").trim();
    if (!titleInput.value || ["第一页", "无标题页"].includes(titleInput.value)) {
      titleInput.value = safeTitle;
      titleInput.dispatchEvent(new Event("input", { bubbles: true }));
    }

    const section = document.createElement("section");
    section.className = "paperbook-scan-block";
    const heading = document.createElement("h2");
    heading.textContent = safeTitle;
    const body = document.createElement("div");
    body.style.whiteSpace = "pre-wrap";
    body.textContent = safeText || "（未识别到文字）";
    section.append(heading, body);
    editor.append(section, document.createElement("p"));
    editor.dispatchEvent(new Event("input", { bubbles: true }));

    if (typeof window.__paperbookSetMobileTab === "function") {
      window.__paperbookSetMobileTab("editor");
    }
    return true;
  };

  window.__paperbookAndroidBack = function () {
    const tab = document.body.dataset.mobileTab;
    if (tab === "editor") {
      window.__paperbookSetMobileTab?.("pages");
      return true;
    }
    if (tab === "pages") {
      window.__paperbookSetMobileTab?.("books");
      return true;
    }
    return false;
  };

  const originalAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (
      this.download &&
      this.href?.startsWith("blob:") &&
      typeof window.AndroidBridge?.saveDataUrl === "function"
    ) {
      const anchor = this;
      fetch(anchor.href)
        .then(response => response.blob())
        .then(blob => {
          const reader = new FileReader();
          reader.onloadend = () => window.AndroidBridge.saveDataUrl(
            anchor.download || "PaperBook_备份.json",
            String(reader.result || ""),
            blob.type || "application/octet-stream"
          );
          reader.readAsDataURL(blob);
        })
        .catch(() => originalAnchorClick.call(anchor));
      return;
    }
    return originalAnchorClick.apply(this, arguments);
  };
})();
