(function () {
  const params = new URLSearchParams(location.search);
  if (params.get("embeddedReadOnly") !== "1") return;
  document.documentElement.classList.add("pdfjs-embedded-readonly");
  const send = (type, extra = {}) => parent.postMessage({ type, ...extra }, location.origin);
  const start = async (event) => {
    if (event.detail?.source !== window) return;
    parent.document.removeEventListener("webviewerloaded", start);
    document.removeEventListener("webviewerloaded", start);
    window.PDFViewerApplicationOptions.setAll({ disablePreferences: true, disableHistory: true,
      enableScripting: false, annotationEditorMode: -1, sidebarViewOnLoad: 0, viewOnLoad: 1 });
    const app = window.PDFViewerApplication;
    try {
      await app.initializedPromise;
      const file = params.get("embeddedFile");
      if (!file || !file.startsWith(`blob:${location.origin}/`)) throw new Error("No se pudo acceder al PDF temporal.");
      app.eventBus.on("pagesinit", () => { app.pdfViewer.currentScaleValue = "page-width"; });
      app.eventBus.on("documenterror", () => send("subjectPdfError"));
      const position = async () => {
        const serialized = params.get("fragmentRegion");
        if (serialized) {
          const { scrollToFragmentRegion } = await import("./fragment-position.mjs");
          await scrollToFragmentRegion(app, serialized);
        } else app.pdfViewer.scrollPageIntoView({ pageNumber: 1 });
        const targetPage = serialized ? JSON.parse(serialized).page : 1;
        app.pdfViewer.update();
        if (app.pdfViewer.getPageView(targetPage - 1)?.renderingState !== 3) await new Promise((resolve, reject) => {
          const timer = setTimeout(() => { app.eventBus.off("pagerendered", rendered); reject(new Error("Render timeout")); }, 15000);
          const rendered = event => {
            if (event.pageNumber !== targetPage) return;
            clearTimeout(timer); app.eventBus.off("pagerendered", rendered);
            if (event.error) reject(event.error); else resolve();
          };
          app.eventBus.on("pagerendered", rendered);
        });
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        send("subjectPdfReady");
      };
      window.addEventListener("message", event => {
        if (event.origin !== location.origin || event.source !== parent || event.data?.type !== "subjectPdfReposition") return;
        void position().catch(() => send("subjectPdfError"));
      });
      let positioned = false;
      app.eventBus.on("pagerendered", async event => {
        if (positioned) return;
        positioned = true;
        if (event.error) { send("subjectPdfError"); return; }
        try {
          await position();
        } catch { send("subjectPdfError"); }
      });
      await app.open({ url: file });
    } catch { send("subjectPdfError", { message: "No se pudo mostrar el PDF. Reintentá o comprobá el archivo original." }); }
  };
  parent.document.addEventListener("webviewerloaded", start);
  document.addEventListener("webviewerloaded", start);
  document.addEventListener("keydown", event => {
    if (event.isComposing || event.altKey || event.shiftKey) return;
    if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]")) return;
    const undo = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z";
    const back = !event.ctrlKey && !event.metaKey && ["Escape", "Backspace"].includes(event.key);
    if (!undo && !back) return;
    event.preventDefault(); event.stopImmediatePropagation();
    send("subjectPdfKey", { key: undo ? "undo" : "back" });
  }, true);
})();
