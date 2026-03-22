(function () {
  const state = {
    app: null,
    query: null,
    selectionMode: false,
    selections: [],
    drag: null,
    sourcePdfBytes: null,
    sourcePdfLibDoc: null,
    toastStack: null,
    statusNode: null,
    modal: null,
    modalInput: null,
    modalConfirm: null,
    modalCancel: null,
    busy: null,
    busyText: null,
    draftOverlay: null,
  };
  const ENHANCED_PDF_CANVAS_FILTER = "grayscale(100%) contrast(150%) brightness(95%)";

  function parseQuery() {
    const params = new URLSearchParams(window.location.search);
    return {
      materialId: Number.parseInt(params.get("materialId") || "", 10),
      subjectId: String(params.get("subjectId") || "").trim(),
      subjectName: String(params.get("subjectName") || "").trim(),
      sessionDate: String(params.get("sessionDate") || "").trim(),
      weekNumber: Number.parseInt(params.get("weekNumber") || "", 10),
      weekdayIndex: Number.parseInt(params.get("weekdayIndex") || "", 10),
      fileName: String(params.get("fileName") || "").trim(),
      key: String(params.get("key") || "").trim(),
    };
  }

  function isEditableTarget(target) {
    if (!(target instanceof HTMLElement)) return false;
    if (target.closest(".pdfjs-custom-modal-backdrop[data-open='true']")) return true;
    return Boolean(
      target.closest(
        "input, textarea, select, button, [contenteditable='true'], .dialog, #secondaryToolbar, #findbar, .dropdownToolbarButton"
      )
    );
  }

  function ensureUi() {
    if (!state.toastStack) {
      state.toastStack = document.createElement("div");
      state.toastStack.className = "pdfjs-custom-toast-stack";
      document.body.appendChild(state.toastStack);
    }

    if (!state.statusNode) {
      state.statusNode = document.createElement("div");
      state.statusNode.className = "pdfjs-custom-status";
      document.body.appendChild(state.statusNode);
    }

    if (!state.modal) {
      const backdrop = document.createElement("div");
      backdrop.className = "pdfjs-custom-modal-backdrop";
      backdrop.innerHTML = [
        '<div class="pdfjs-custom-modal" role="dialog" aria-modal="true" aria-labelledby="pdfjs-custom-modal-title">',
        '<h2 id="pdfjs-custom-modal-title">Crear PDF fragmentado</h2>',
        "<p>Se generara un nuevo PDF con las selecciones activas y se subira como material de practica.</p>",
        '<label for="pdfjs-custom-modal-input">Nombre del archivo</label>',
        '<input id="pdfjs-custom-modal-input" type="text" autocomplete="off" />',
        '<div class="pdfjs-custom-modal-actions">',
        '<button type="button" data-variant="ghost" id="pdfjs-custom-modal-cancel">Cancelar</button>',
        '<button type="button" data-variant="primary" id="pdfjs-custom-modal-confirm">Confirmar</button>',
        "</div>",
        "</div>",
      ].join("");
      backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) {
          closeModal();
        }
      });
      document.body.appendChild(backdrop);
      state.modal = backdrop;
      state.modalInput = backdrop.querySelector("#pdfjs-custom-modal-input");
      state.modalConfirm = backdrop.querySelector("#pdfjs-custom-modal-confirm");
      state.modalCancel = backdrop.querySelector("#pdfjs-custom-modal-cancel");

      state.modalCancel.addEventListener("click", () => closeModal());
      state.modalConfirm.addEventListener("click", () => {
        void submitSelectionsPdf(state.modalInput.value);
      });
      state.modalInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void submitSelectionsPdf(state.modalInput.value);
        } else if (event.key === "Escape") {
          event.preventDefault();
          closeModal();
        }
      });
    }

    if (!state.busy) {
      const busy = document.createElement("div");
      busy.className = "pdfjs-custom-busy";
      busy.innerHTML = '<div class="pdfjs-custom-busy-card" id="pdfjs-custom-busy-text">Procesando...</div>';
      document.body.appendChild(busy);
      state.busy = busy;
      state.busyText = busy.querySelector("#pdfjs-custom-busy-text");
    }

    if (!state.draftOverlay) {
      const overlay = document.createElement("div");
      overlay.className = "pdfjs-custom-draft-overlay";
      overlay.innerHTML = [
        '<div class="pdfjs-custom-draft-card">',
        "<h2>Agrega un PDF</h2>",
        "<p>Carga un libro en RAM para seleccionar fragmentos y crear un PDF nuevo. Tambien puedes arrastrar un PDF a esta ventana.</p>",
        '<button type="button" id="pdfjs-custom-draft-open">Elegir PDF</button>',
        "</div>",
      ].join("");
      document.body.appendChild(overlay);
      state.draftOverlay = overlay;
      overlay.querySelector("#pdfjs-custom-draft-open").addEventListener("click", () => {
        state.app?.eventBus?.dispatch("openfile", { source: window });
      });
    }
  }

  function showToast(message, tone = "info", duration = 2600) {
    ensureUi();
    const toast = document.createElement("div");
    toast.className = "pdfjs-custom-toast";
    toast.dataset.tone = tone;
    toast.textContent = message;
    state.toastStack.appendChild(toast);
    requestAnimationFrame(() => {
      toast.dataset.visible = "true";
    });
    window.setTimeout(() => {
      toast.dataset.visible = "false";
      window.setTimeout(() => toast.remove(), 180);
    }, duration);
  }

  function showStatus(message) {
    ensureUi();
    state.statusNode.textContent = message;
    state.statusNode.dataset.visible = "true";
  }

  function hideStatus() {
    if (state.statusNode) {
      state.statusNode.dataset.visible = "false";
    }
  }

  function showBusy(message) {
    ensureUi();
    state.busyText.textContent = message;
    state.busy.dataset.open = "true";
  }

  function updateBusy(message) {
    if (state.busyText) {
      state.busyText.textContent = message;
    }
  }

  function hideBusy() {
    if (state.busy) {
      state.busy.dataset.open = "false";
    }
  }

  function sanitizeName(name) {
    return (
      String(name || "documento")
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "") || "documento"
    );
  }

  function normalizePdfFileName(name) {
    const base = sanitizeName(String(name || "").trim() || getDefaultBaseName());
    return base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`;
  }

  function getDefaultBaseName() {
    const currentName = state.query.fileName || state.app?._docFilename || "fragmento";
    return String(currentName).replace(/\.pdf$/i, "") || "fragmento";
  }

  function canUseFragmentUpload() {
    const query = state.query;
    return Boolean(
      query.subjectId &&
        query.subjectName &&
        /^\d{4}-\d{2}-\d{2}$/.test(query.sessionDate) &&
        Number.isInteger(query.weekNumber)
    );
  }

  function isDraftMode() {
    return !Number.isInteger(state.query.materialId);
  }

  function updateDraftOverlay() {
    if (!state.draftOverlay) return;
    const shouldShow = isDraftMode() && !state.app?.pdfDocument;
    state.draftOverlay.dataset.open = shouldShow ? "true" : "false";
  }

  function clearSelections() {
    state.selections = [];
    refreshLayers();
  }

  function enterSelectionMode() {
    if (!state.app?.pdfDocument) {
      showToast("Primero carga un PDF.", "info");
      return;
    }
    clearSelections();
    state.selectionMode = true;
    refreshLayers();
    showStatus("Modo seleccion activo. Delimita areas y luego pulsa Ctrl+M.");
    showToast("Modo seleccion activado.", "info");
  }

  function leaveSelectionMode(message) {
    state.selectionMode = false;
    state.drag = null;
    refreshLayers();
    hideStatus();
    if (message) {
      showToast(message, "info");
    }
  }

  function toggleSelectionMode() {
    if (!state.selectionMode) {
      enterSelectionMode();
      return;
    }
    const message = state.selections.length ? "Selecciones listas para crear el PDF." : "Seleccion cancelada.";
    leaveSelectionMode(message);
  }

  function getPageRotation(pageNumber) {
    const rotation = state.app?.pdfViewer?.getPageView(pageNumber - 1)?.rotation;
    if (typeof rotation !== "number") return 0;
    const normalized = rotation % 360;
    return normalized < 0 ? normalized + 360 : normalized;
  }

  function makeSelectionFromDrag(pageNumber) {
    if (!state.drag) return null;
    const { startXp, startYp, currentXp, currentYp } = state.drag;
    const minXp = Math.min(startXp, currentXp);
    const maxXp = Math.max(startXp, currentXp);
    const minYp = Math.min(startYp, currentYp);
    const maxYp = Math.max(startYp, currentYp);
    if (Math.abs(maxXp - minXp) < 0.005 || Math.abs(maxYp - minYp) < 0.005) {
      return null;
    }
    return {
      id: `${pageNumber}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      pageNum: pageNumber,
      pageRotation: getPageRotation(pageNumber),
      xp1: minXp,
      yp1: minYp,
      xp2: maxXp,
      yp2: maxYp,
    };
  }

  function clamp01(value) {
    return Math.min(1, Math.max(0, value));
  }

  function getCoords(event, pageElement) {
    const rect = pageElement.getBoundingClientRect();
    return {
      xp: clamp01((event.clientX - rect.left) / rect.width),
      yp: clamp01((event.clientY - rect.top) / rect.height),
    };
  }

  function ensureLayer(pageElement) {
    let layer = pageElement.querySelector(".pdfjs-custom-selection-layer");
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "pdfjs-custom-selection-layer";
      pageElement.appendChild(layer);
      layer.addEventListener("mousedown", (event) => {
        if (!state.selectionMode || event.button !== 0) return;
        if (!(event.currentTarget instanceof HTMLElement)) return;
        const page = event.currentTarget.closest(".page");
        if (!(page instanceof HTMLElement)) return;

        const pageNumber = Number.parseInt(page.dataset.pageNumber || "", 10);
        if (!Number.isInteger(pageNumber)) return;

        const { xp, yp } = getCoords(event, page);
        state.drag = {
          pageNumber,
          startXp: xp,
          startYp: yp,
          currentXp: xp,
          currentYp: yp,
        };
        event.preventDefault();
        refreshLayers();

        const handleMove = (moveEvent) => {
          if (!state.drag || state.drag.pageNumber !== pageNumber) return;
          const next = getCoords(moveEvent, page);
          state.drag.currentXp = next.xp;
          state.drag.currentYp = next.yp;
          refreshLayers();
        };

        const handleUp = (upEvent) => {
          window.removeEventListener("mousemove", handleMove, true);
          window.removeEventListener("mouseup", handleUp, true);
          if (!state.drag) return;
          const next = getCoords(upEvent, page);
          state.drag.currentXp = next.xp;
          state.drag.currentYp = next.yp;
          const selection = makeSelectionFromDrag(pageNumber);
          state.drag = null;
          if (selection) {
            state.selections.push(selection);
            showToast(`Seleccion agregada en pagina ${pageNumber}.`, "success", 1800);
          }
          refreshLayers();
        };

        window.addEventListener("mousemove", handleMove, true);
        window.addEventListener("mouseup", handleUp, true);
      });
    }

    layer.classList.toggle("is-active", state.selectionMode);
    return layer;
  }

  function renderSelectionBox(layer, selection, draft) {
    const box = document.createElement("div");
    box.className = `pdfjs-custom-selection-box${draft ? " is-draft" : ""}`;
    const left = Math.min(selection.xp1, selection.xp2);
    const top = Math.min(selection.yp1, selection.yp2);
    const width = Math.abs(selection.xp2 - selection.xp1);
    const height = Math.abs(selection.yp2 - selection.yp1);
    box.style.left = `${left * 100}%`;
    box.style.top = `${top * 100}%`;
    box.style.width = `${width * 100}%`;
    box.style.height = `${height * 100}%`;
    layer.appendChild(box);
    return box;
  }

  function refreshLayers() {
    document.querySelectorAll(".page").forEach((pageElement) => {
      if (!(pageElement instanceof HTMLElement)) return;
      const pageNumber = Number.parseInt(pageElement.dataset.pageNumber || "", 10);
      if (!Number.isInteger(pageNumber)) return;

      const layer = ensureLayer(pageElement);
      layer.replaceChildren();

      const selections = state.selections.filter((item) => item.pageNum === pageNumber);
      selections.forEach((selection, index) => {
        const box = renderSelectionBox(layer, selection, false);
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "pdfjs-custom-selection-chip";
        chip.textContent = String(index + 1);
        chip.title = "Eliminar seleccion";
        chip.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          state.selections = state.selections.filter((item) => item.id !== selection.id);
          refreshLayers();
          showToast("Seleccion eliminada.", "info", 1600);
        });
        box.appendChild(chip);
      });

      if (state.drag && state.drag.pageNumber === pageNumber) {
        renderSelectionBox(
          layer,
          {
            xp1: state.drag.startXp,
            yp1: state.drag.startYp,
            xp2: state.drag.currentXp,
            yp2: state.drag.currentYp,
          },
          true
        );
      }
    });
  }

  async function ensureSourcePdfDoc() {
    if (state.sourcePdfLibDoc && state.sourcePdfBytes) {
      return state.sourcePdfLibDoc;
    }
    if (!window.PDFLib?.PDFDocument) {
      throw new Error("pdf-lib no esta disponible en este visor.");
    }
    if (!state.app?.pdfDocument) {
      throw new Error("No hay un PDF cargado.");
    }

    state.sourcePdfBytes = await state.app.pdfDocument.getData();
    state.sourcePdfLibDoc = await window.PDFLib.PDFDocument.load(state.sourcePdfBytes);
    return state.sourcePdfLibDoc;
  }

  async function buildPdfFromSelections(fileName) {
    if (!state.selections.length) {
      throw new Error("Selecciona al menos un area con Ctrl+I antes de crear el PDF.");
    }

    const sourceDoc = await ensureSourcePdfDoc();
    const outputDoc = await window.PDFLib.PDFDocument.create();
    const orderedSelections = [...state.selections].sort((left, right) => {
      if (left.pageNum !== right.pageNum) return left.pageNum - right.pageNum;
      return left.id.localeCompare(right.id);
    });

    for (const selection of orderedSelections) {
      const sourcePage = sourceDoc.getPage(selection.pageNum - 1);
      if (!sourcePage) {
        throw new Error(`No se pudo leer la pagina ${selection.pageNum}.`);
      }

      const cropBox = sourcePage.getCropBox();
      const cropLeft = cropBox.x || 0;
      const cropBottom = cropBox.y || 0;
      const cropWidth = cropBox.width || sourcePage.getWidth();
      const cropHeight = cropBox.height || sourcePage.getHeight();

      const normalizedBounds = getNormalizedBoundsForSelection(selection);
      const minXp = normalizedBounds.left;
      const maxXp = normalizedBounds.right;
      const minYp = normalizedBounds.top;
      const maxYp = normalizedBounds.bottom;

      const left = cropLeft + minXp * cropWidth;
      const right = cropLeft + maxXp * cropWidth;
      const top = cropBottom + cropHeight - minYp * cropHeight;
      const bottom = cropBottom + cropHeight - maxYp * cropHeight;
      const width = Math.max(1, right - left);
      const height = Math.max(1, top - bottom);
      const pageRotation = typeof selection.pageRotation === "number" ? selection.pageRotation : 0;

      const embeddedPage = await outputDoc.embedPage(sourcePage, {
        left,
        right,
        bottom,
        top,
      });
      const rotated = pageRotation === 90 || pageRotation === 270;
      const page = outputDoc.addPage(rotated ? [height, width] : [width, height]);

      if (pageRotation === 90) {
        page.drawPage(embeddedPage, {
          x: 0,
          y: width,
          width,
          height,
          rotate: window.PDFLib.degrees(270),
        });
      } else if (pageRotation === 180) {
        page.drawPage(embeddedPage, {
          x: width,
          y: height,
          width,
          height,
          rotate: window.PDFLib.degrees(180),
        });
      } else if (pageRotation === 270) {
        page.drawPage(embeddedPage, {
          x: height,
          y: 0,
          width,
          height,
          rotate: window.PDFLib.degrees(90),
        });
      } else {
        page.drawPage(embeddedPage, {
          x: 0,
          y: 0,
          width,
          height,
        });
      }
    }

    const pdfBytes = await outputDoc.save();
    return {
      blob: new Blob([pdfBytes], { type: "application/pdf" }),
      fileName: normalizePdfFileName(fileName),
    };
  }

  function mapDisplayedPointToOriginal(xp, yp, rotation) {
    switch (rotation) {
      case 90:
        return { xp: yp, yp: 1 - xp };
      case 180:
        return { xp: 1 - xp, yp: 1 - yp };
      case 270:
        return { xp: 1 - yp, yp: xp };
      default:
        return { xp, yp };
    }
  }

  function getNormalizedBoundsForSelection(selection) {
    const rotation = typeof selection.pageRotation === "number" ? selection.pageRotation : 0;
    const corners = [
      mapDisplayedPointToOriginal(selection.xp1, selection.yp1, rotation),
      mapDisplayedPointToOriginal(selection.xp1, selection.yp2, rotation),
      mapDisplayedPointToOriginal(selection.xp2, selection.yp1, rotation),
      mapDisplayedPointToOriginal(selection.xp2, selection.yp2, rotation),
    ];

    const xs = corners.map((point) => point.xp);
    const ys = corners.map((point) => point.yp);

    return {
      left: Math.max(0, Math.min(...xs)),
      right: Math.min(1, Math.max(...xs)),
      top: Math.max(0, Math.min(...ys)),
      bottom: Math.min(1, Math.max(...ys)),
    };
  }

  async function readJsonish(response) {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  function getErrorMessage(payload, fallback) {
    if (payload && typeof payload === "object" && typeof payload.error === "string") {
      return payload.error;
    }
    if (typeof payload === "string" && payload.trim()) {
      return payload;
    }
    return fallback;
  }

  async function requireOkJson(response, fallback) {
    const payload = await readJsonish(response);
    if (!response.ok) {
      throw new Error(getErrorMessage(payload, fallback));
    }
    return payload;
  }

  async function uploadBlobToStorage(session, blob) {
    if (session.uploadMode === "direct") {
      if (!session.uploadUrl) {
        throw new Error("Falta la URL firmada para subir el archivo al storage.");
      }

      const response = await fetch(session.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": session.mimeType || blob.type || "application/octet-stream",
        },
        body: blob,
      });

      if (!response.ok) {
        const payload = await readJsonish(response);
        throw new Error(getErrorMessage(payload, `No se pudo subir el archivo al storage. (${response.status})`));
      }

      return {
        driveFileId: session.driveFileId || session.objectKey || "",
      };
    }

    const formData = new FormData();
    formData.set("file", blob, session.fileName);
    formData.set("objectKey", session.objectKey);
    formData.set("mimeType", session.mimeType || blob.type || "application/octet-stream");

    if (session.metadata && Object.keys(session.metadata).length > 0) {
      formData.set("metadata", JSON.stringify(session.metadata));
    }

    const response = await fetch("/api/storage/r2-upload", {
      method: "POST",
      body: formData,
    });
    const payload = await readJsonish(response);
    if (!response.ok) {
      throw new Error(getErrorMessage(payload, "No se pudo subir el archivo al storage."));
    }

    const driveFileId =
      (payload && typeof payload === "object" && typeof payload.driveFileId === "string" ? payload.driveFileId : "") ||
      session.driveFileId ||
      "";

    if (!driveFileId) {
      throw new Error("El storage no devolvio el identificador del archivo subido.");
    }

    return { driveFileId };
  }

  function notifyPracticeMaterialsRefresh() {
    const payload = {
      subjectId: state.query.subjectId,
      sessionDate: state.query.sessionDate,
      weekNumber: state.query.weekNumber,
      timestamp: Date.now(),
    };

    try {
      const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("practice-materials") : null;
      channel?.postMessage(payload);
      channel?.close();
    } catch {}

    try {
      window.localStorage.setItem("practice-materials:refresh", JSON.stringify(payload));
    } catch {}
  }

  function openModal() {
    if (!state.app?.pdfDocument) {
      showToast("Primero carga un PDF.", "info");
      return;
    }

    if (!state.selections.length) {
      showToast("Selecciona al menos un area con Ctrl+I antes de crear el PDF.", "info");
      return;
    }

    if (!canUseFragmentUpload()) {
      showToast("A este visor le falta el contexto de materia o fecha para subir el PDF.", "error", 3400);
      return;
    }

    ensureUi();
    state.modalInput.value = normalizePdfFileName(getDefaultBaseName()).replace(/\.pdf$/i, "");
    state.modal.dataset.open = "true";
    window.setTimeout(() => {
      state.modalInput.focus();
      state.modalInput.select();
    }, 0);
  }

  function closeModal() {
    if (state.modal) {
      state.modal.dataset.open = "false";
    }
  }

  async function submitSelectionsPdf(inputName) {
    closeModal();
    showBusy("Armando PDF fragmentado...");

    try {
      const pdfData = await buildPdfFromSelections(inputName);
      updateBusy("Preparando subida...");

      const sessionPayload = await requireOkJson(
        await fetch("/api/subject-day-materials/upload-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subjectId: state.query.subjectId,
            subjectName: state.query.subjectName,
            sessionDate: state.query.sessionDate,
            weekNumber: state.query.weekNumber,
            materialType: "practice",
            mimeType: "application/pdf",
            fileName: pdfData.fileName,
          }),
        }),
        "No se pudo preparar la subida del PDF fragmentado."
      );

      updateBusy("Subiendo PDF fragmentado...");
      const uploadResult = await uploadBlobToStorage(sessionPayload, pdfData.blob);

      updateBusy("Registrando material...");
      await requireOkJson(
        await fetch("/api/subject-day-materials/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subjectId: state.query.subjectId,
            sessionDate: state.query.sessionDate,
            weekNumber: state.query.weekNumber,
            materialType: "practice",
            driveFileId: uploadResult.driveFileId,
            fileName: pdfData.fileName,
          }),
        }),
        "No se pudo confirmar el PDF fragmentado."
      );

      notifyPracticeMaterialsRefresh();
      clearSelections();
      leaveSelectionMode();
      showToast(`PDF creado: ${pdfData.fileName}`, "success", 3200);
    } catch (error) {
      console.error("Custom PDF.js fragment upload failed:", error);
      showToast(error instanceof Error ? error.message : "No se pudo crear el PDF fragmentado.", "error", 4200);
    } finally {
      hideBusy();
    }
  }

  function onDocumentLoaded() {
    state.sourcePdfBytes = null;
    state.sourcePdfLibDoc = null;
    clearSelections();
    leaveSelectionMode();
    updateDraftOverlay();
  }

  function handleKeyDown(event) {
    if (!state.app || event.defaultPrevented || event.repeat) return;
    if (isEditableTarget(event.target)) return;

    const key = event.key.toLowerCase();

    if (!event.ctrlKey && !event.altKey && !event.metaKey && key === "e") {
      const canvases = document.querySelectorAll("#viewer .page canvas");
      canvases.forEach((canvas) => {
        canvas.style.filter =
          canvas.style.filter === ENHANCED_PDF_CANVAS_FILTER ? "" : ENHANCED_PDF_CANVAS_FILTER;
      });
      return;
    }

    if (event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && key === "i") {
      event.preventDefault();
      toggleSelectionMode();
      return;
    }

    if (event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && key === "m") {
      event.preventDefault();
      openModal();
    }
  }

  async function waitForPdfViewerApplication() {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const app = window.PDFViewerApplication;
      if (app?.initializedPromise) {
        return app;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }

    return null;
  }

  async function init() {
    const app = await waitForPdfViewerApplication();
    if (!app?.initializedPromise) return;

    await app.initializedPromise;
    state.app = app;
    state.query = parseQuery();
    ensureUi();
    refreshLayers();
    updateDraftOverlay();

    const { eventBus } = app;
    eventBus.on("pagerendered", refreshLayers);
    eventBus.on("pagechanging", refreshLayers);
    eventBus.on("scalechanging", refreshLayers);
    eventBus.on("rotationchanging", refreshLayers);
    eventBus.on("documentloaded", onDocumentLoaded);
    eventBus.on("documenterror", updateDraftOverlay);
    document.addEventListener("keydown", handleKeyDown, true);

    if (!window.PDFLib?.PDFDocument) {
      showToast("No se pudo cargar pdf-lib localmente. Ctrl+M no estara disponible.", "error", 5000);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      void init();
    });
  } else {
    void init();
  }
})();
