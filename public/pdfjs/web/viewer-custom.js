(function () {
  const hasInitialPresentationQuery = String(
    new URLSearchParams(window.location.search).get("presentationTagIds") || ""
  ).trim().length > 0;
  if (hasInitialPresentationQuery) {
    document.documentElement.classList.add("pdfjs-custom-presentation-preparing");
  }

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
    loadingOverlay: null,
    loadingText: null,
    draftOverlay: null,
    syncButton: null,
    secondarySyncButton: null,
    replaceButton: null,
    secondaryReplaceButton: null,
    replaceInput: null,
    replacementBackdrop: null,
    replacementDescription: null,
    replacementAutoCount: null,
    replacementReviewCount: null,
    replacementUnmatchedCount: null,
    replacementReviewList: null,
    replacementUnmatchedList: null,
    replacementConfirm: null,
    replacementCancel: null,
    replacementPreview: null,
    replacementToken: "",
    replacementCandidateBytes: null,
    replacementDecisions: new Map(),
    pageTextModels: new Map(),
    syncStatePoller: null,
    isSyncing: false,
    isSynced: false,
    hasUnsyncedChanges: false,
    suppressUnloadSync: false,
    pendingExitSync: false,
    exitSyncTimer: null,
    statusTimer: null,
    enhancedPdfReadability: false,
    workspaceMode: "remote",
    workspaceRootHandle: null,
    localWorkspaceObjectUrl: "",
    isOpeningLocalWorkspaceDocument: false,
    tagButton: null,
    tagPanel: null,
    tagInput: null,
    tagStatus: null,
    tagList: null,
    tagSuggestions: null,
    tagColorInput: null,
    tagCatalog: [],
    assignedTagIds: new Set(),
    tagRegionCounts: {},
    activeRegionTagId: null,
    activeRegionTagName: "",
    editingTagId: null,
    presentationRegionsByTag: new Map(),
    presentationPendingTagIds: new Set(),
    presentationPhase: "idle",
    presentationFileName: "",
    presentationScaleInitialized: false,
    cutButton: null,
    cutSelectionMode: false,
    cutStartPage: null,
    cutEndPage: null,
    isExportingPageRange: false,
  };
  const ENHANCED_PDF_CANVAS_FILTER = "grayscale(100%) contrast(150%) brightness(95%)";
  const DEFAULT_HIGHLIGHT_COLOR = [255, 240, 102];
  const DEFAULT_HIGHLIGHT_OPACITY = 1;
  const MAX_CONTEXT_LENGTH = 64;
  const MIN_SELECTABLE_TEXT = 24;

  function parseQuery() {
    const params = new URLSearchParams(window.location.search);
    return {
      resourceType: String(params.get("resourceType") || "material").trim() === "cronograma" ? "cronograma" : "material",
      materialId: Number.parseInt(params.get("materialId") || "", 10),
      subjectId: String(params.get("subjectId") || "").trim(),
      subjectName: String(params.get("subjectName") || "").trim(),
      sessionDate: String(params.get("sessionDate") || "").trim(),
      weekNumber: Number.parseInt(params.get("weekNumber") || "", 10),
      weekdayIndex: Number.parseInt(params.get("weekdayIndex") || "", 10),
      materialType: String(params.get("materialType") || "practice").trim() || "practice",
      fileName: String(params.get("fileName") || "").trim(),
      key: String(params.get("key") || "").trim(),
      localWorkspace: params.get("localWorkspace") === "1",
      workspaceFileId: String(params.get("workspaceFileId") || "").trim(),
      viewerMode: String(params.get("viewerMode") || "standalone").trim() === "inline" ? "inline" : "standalone",
      returnToken: String(params.get("returnToken") || "").trim(),
      presentationTagIds: Array.from(new Set(
        String(params.get("presentationTagIds") || "")
          .split(",")
          .map((value) => Number.parseInt(value, 10))
          .filter(Number.isInteger)
      )),
    };
  }

  function postToParent(message) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(message, window.location.origin);
    }
  }

  function isCronogramaResource() {
    return state.query?.resourceType === "cronograma";
  }

  function isPresentationMode() {
    return Array.isArray(state.query?.presentationTagIds) && state.query.presentationTagIds.length > 0;
  }

  function isEditableTarget(target) {
    if (!(target instanceof HTMLElement)) return false;
    if (
      target.closest(".pdfjs-custom-modal-backdrop[data-open='true']") ||
      target.closest(".pdfjs-custom-replacement-backdrop[data-open='true']")
    ) {
      return true;
    }
    return Boolean(
      target.closest(
        "input, textarea, select, button, [contenteditable='true'], .dialog, #secondaryToolbar, #findbar, .dropdownToolbarButton"
      )
    );
  }

  function isDraftMode() {
    return !isCronogramaResource() && !Number.isInteger(state.query?.materialId);
  }

  function isLocalWorkspaceMode() {
    return state.workspaceMode === "local" || Boolean(state.query?.localWorkspace);
  }

  function canSyncCurrentDocument() {
    if (isPresentationMode()) {
      return false;
    }
    if (isLocalWorkspaceMode()) {
      return Boolean(state.query?.workspaceFileId);
    }
    return isCronogramaResource() || (!isDraftMode() && Number.isInteger(state.query?.materialId));
  }

  function canReplaceMaterial() {
    if (isPresentationMode()) {
      return false;
    }
    if (isLocalWorkspaceMode()) {
      return false;
    }
    return !isCronogramaResource() && !isDraftMode() && Number.isInteger(state.query?.materialId);
  }

  function hasUnsyncedAnnotations() {
    return Boolean(state.app?.pdfDocument?.annotationStorage?.size > 0 && state.app?._annotationStorageModified);
  }

  function getCurrentFileUrl(cacheBust = false) {
    if (isCronogramaResource()) {
      const cronogramaUrl = "/api/cronograma/file";
      return cacheBust ? `${cronogramaUrl}?t=${Date.now()}` : cronogramaUrl;
    }
    if (!canSyncCurrentDocument()) return "";
    const baseUrl = `/api/subject-day-materials/${state.query.materialId}/file`;
    return cacheBust ? `${baseUrl}?t=${Date.now()}` : baseUrl;
  }

  function getCurrentSyncUrl() {
    if (isCronogramaResource()) {
      return "/api/cronograma/sync";
    }
    if (Number.isInteger(state.query?.materialId)) {
      return `/api/subject-day-materials/${state.query.materialId}/sync`;
    }
    return "";
  }

  function openWorkspaceDb() {
    return new Promise((resolve, reject) => {
      const request = window.indexedDB.open("local-workspace", 1);

      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("workspace")) {
          database.createObjectStore("workspace", { keyPath: "id" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("No se pudo abrir IndexedDB."));
    });
  }

  async function loadWorkspaceRootHandleFromDb() {
    const database = await openWorkspaceDb();

    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction("workspace", "readonly");
        const store = transaction.objectStore("workspace");
        const request = store.get("root-handle");
        request.onsuccess = () => resolve((request.result && request.result.handle) || null);
        request.onerror = () => reject(request.error || new Error("No se pudo leer la carpeta local."));
      });
    } finally {
      database.close();
    }
  }

  async function ensureWorkspaceRootHandle() {
    if (state.workspaceRootHandle) {
      return state.workspaceRootHandle;
    }

    let handle = null;
    try {
      handle = await loadWorkspaceRootHandleFromDb();
    } catch (error) {
      console.warn("Custom PDF.js workspace bootstrap failed:", error);
    }

    if (!handle) {
      throw new Error("No se encontro la carpeta local guardada.");
    }

    let permission = "prompt";
    try {
      permission = await handle.queryPermission({ mode: "readwrite" });
    } catch {}

    if (permission !== "granted") {
      try {
        permission = await handle.requestPermission({ mode: "readwrite" });
      } catch {
        permission = "denied";
      }
    }

    if (permission !== "granted") {
      throw new Error("No hay permiso de lectura/escritura para la carpeta local.");
    }

    state.workspaceRootHandle = handle;
    return handle;
  }

  function workspaceIdToSegments(workspaceId) {
    if (!workspaceId || !String(workspaceId).startsWith("workspace://")) {
      throw new Error("No hay un archivo local valido para sincronizar.");
    }

    return String(workspaceId)
      .slice("workspace://".length)
      .split("/")
      .filter((segment) => segment.length > 0);
  }

  async function getWorkspaceFileHandle(workspaceId) {
    const rootHandle = await ensureWorkspaceRootHandle();
    const segments = workspaceIdToSegments(workspaceId);
    const fileName = segments.pop();
    if (!fileName) {
      throw new Error("Ruta de archivo local invalida.");
    }

    let directoryHandle = rootHandle;
    for (const segment of segments) {
      directoryHandle = await directoryHandle.getDirectoryHandle(segment, { create: false });
    }

    return directoryHandle.getFileHandle(fileName, { create: false });
  }

  async function syncAnnotatedPdfToLocalWorkspace(pdfBytes, fileName) {
    const fileHandle = await getWorkspaceFileHandle(state.query?.workspaceFileId);
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(new File([pdfBytes], fileName, { type: "application/pdf" }));
    } finally {
      await writable.close();
    }
  }

  function cleanupLocalWorkspaceObjectUrl() {
    if (state.localWorkspaceObjectUrl) {
      URL.revokeObjectURL(state.localWorkspaceObjectUrl);
      state.localWorkspaceObjectUrl = "";
    }
  }

  async function createLocalWorkspaceObjectUrl() {
    const fileHandle = await getWorkspaceFileHandle(state.query?.workspaceFileId);
    const file = await fileHandle.getFile();
    return URL.createObjectURL(file);
  }

  async function openLocalWorkspaceDocumentInViewer() {
    if (!isLocalWorkspaceMode() || !state.query?.workspaceFileId || !state.app?.open) {
      return false;
    }
    if (state.isOpeningLocalWorkspaceDocument) {
      return false;
    }
    if (state.localWorkspaceObjectUrl && state.app?.pdfDocument) {
      return true;
    }

    state.isOpeningLocalWorkspaceDocument = true;
    cleanupLocalWorkspaceObjectUrl();
    let objectUrl = "";

    try {
      objectUrl = await createLocalWorkspaceObjectUrl();
      state.localWorkspaceObjectUrl = objectUrl;
      await state.app.open({
        url: objectUrl,
        originalUrl: objectUrl,
        filename: state.query.fileName || "material.pdf",
      });
      refreshDocumentViewerMetadata();
      return true;
    } catch (error) {
      if (objectUrl && state.localWorkspaceObjectUrl === objectUrl) {
        cleanupLocalWorkspaceObjectUrl();
      }
      throw error;
    } finally {
      state.isOpeningLocalWorkspaceDocument = false;
    }
  }

  function ensureUi() {
    if (!state.cutButton) {
      const downloadButton = document.getElementById("downloadButton");
      const toolbar = downloadButton?.parentElement || document.getElementById("toolbarViewerRight");
      if (toolbar) {
        const button = document.createElement("button");
        button.id = "pdfjs-custom-cut-button";
        button.className = "toolbarButton pdfjs-custom-cut-button";
        button.type = "button";
        button.tabIndex = 0;
        button.title = "Recortar paginas";
        button.setAttribute("aria-label", "Recortar paginas");
        button.innerHTML = [
          '<svg aria-hidden="true" viewBox="0 0 24 24">',
          '<circle cx="6" cy="7" r="3"></circle>',
          '<circle cx="6" cy="17" r="3"></circle>',
          '<path d="m8.7 8.4 10.8 7.1"></path>',
          '<path d="m8.7 15.6 10.8-7.1"></path>',
          "</svg>",
        ].join("");
        button.addEventListener("click", () => handleCutButtonClick());
        if (downloadButton) {
          toolbar.insertBefore(button, downloadButton);
        } else {
          toolbar.appendChild(button);
        }
        state.cutButton = button;
        refreshCutButton();
      }
    }

    if (!state.tagButton && !isPresentationMode()) {
      const toolbar = document.getElementById("toolbarViewerLeft") || document.getElementById("toolbarViewer");
      if (toolbar) {
        const button = document.createElement("button");
        button.id = "pdfjs-custom-tag-button";
        button.className = "toolbarButton pdfjs-custom-tag-button";
        button.type = "button";
        button.tabIndex = 0;
        button.title = "Agregar tag al PDF";
        button.setAttribute("aria-label", "Agregar tag al PDF");
        button.setAttribute("aria-expanded", "false");
        button.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 13.5 13.5 20a2.12 2.12 0 0 1-3 0L4 13.5V4h9.5L20 10.5a2.12 2.12 0 0 1 0 3Z"></path><circle cx="9" cy="9" r="1.2"></circle></svg>';
        button.addEventListener("click", () => toggleMaterialTagPanel());
        toolbar.appendChild(button);
        state.tagButton = button;

        const panel = document.createElement("form");
        panel.className = "pdfjs-custom-tag-panel";
        panel.innerHTML = [
          '<div id="pdfjs-custom-tag-list" class="pdfjs-custom-tag-list" aria-label="Tags asignados"></div>',
          '<input id="pdfjs-custom-tag-input" type="text" autocomplete="off" placeholder="# asignar o crear" aria-label="Asignar o crear tag" />',
          '<input id="pdfjs-custom-tag-color" type="color" aria-label="Color del tag" hidden />',
          '<button type="submit">Agregar</button>',
          '<div id="pdfjs-custom-tag-suggestions" class="pdfjs-custom-tag-suggestions" hidden></div>',
          '<span id="pdfjs-custom-tag-status" role="status"></span>',
        ].join("");
        panel.addEventListener("submit", (event) => {
          event.preventDefault();
          submitMaterialTag();
        });
        document.body.appendChild(panel);
        state.tagPanel = panel;
        state.tagInput = panel.querySelector("#pdfjs-custom-tag-input");
        state.tagStatus = panel.querySelector("#pdfjs-custom-tag-status");
        state.tagList = panel.querySelector("#pdfjs-custom-tag-list");
        state.tagSuggestions = panel.querySelector("#pdfjs-custom-tag-suggestions");
        state.tagColorInput = panel.querySelector("#pdfjs-custom-tag-color");
        state.tagInput.addEventListener("input", () => renderMaterialTagSuggestions());

        document.getElementById("viewerContainer")?.addEventListener("scroll", () => {
          if (state.activeRegionTagId == null) closeMaterialTagPanel();
        }, { passive: true });
      }
    }

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
        "<p>Se generara un nuevo PDF con las selecciones activas y se subira al material actual.</p>",
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

    if (!state.loadingOverlay) {
      const overlay = document.createElement("div");
      overlay.className = "pdfjs-custom-loading-overlay";
      overlay.innerHTML = '<div class="pdfjs-custom-loading-card" id="pdfjs-custom-loading-text">Cargando PDF...</div>';
      document.body.appendChild(overlay);
      state.loadingOverlay = overlay;
      state.loadingText = overlay.querySelector("#pdfjs-custom-loading-text");
    }

    if (isPresentationMode() && state.presentationPhase !== "ready") {
      document.documentElement.classList.add("pdfjs-custom-presentation-preparing");
      state.loadingText.textContent = "Preparando presentacion...";
      state.loadingOverlay.dataset.open = "true";
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

    if (!state.replaceInput) {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/pdf,.pdf";
      input.hidden = true;
      input.addEventListener("change", () => {
        const file = input.files?.[0];
        if (file) {
          void previewReplacement(file);
        }
        input.value = "";
      });
      document.body.appendChild(input);
      state.replaceInput = input;
    }

    if (!state.replacementBackdrop) {
      const backdrop = document.createElement("div");
      backdrop.className = "pdfjs-custom-replacement-backdrop";
      backdrop.innerHTML = [
        '<div class="pdfjs-custom-replacement-modal" role="dialog" aria-modal="true" aria-labelledby="pdfjs-custom-replacement-title">',
        '<div class="pdfjs-custom-replacement-header">',
        '<h2 id="pdfjs-custom-replacement-title">Reemplazar PDF</h2>',
        '<p id="pdfjs-custom-replacement-description">Se analizara el PDF nuevo y se migraran solo los resaltados seguros.</p>',
        "</div>",
        '<div class="pdfjs-custom-replacement-summary">',
        '<article class="pdfjs-custom-replacement-stat" data-tone="auto"><strong id="pdfjs-custom-replacement-auto">0</strong><span>Migran automatico</span></article>',
        '<article class="pdfjs-custom-replacement-stat" data-tone="review"><strong id="pdfjs-custom-replacement-review">0</strong><span>Requieren revision</span></article>',
        '<article class="pdfjs-custom-replacement-stat" data-tone="unmatched"><strong id="pdfjs-custom-replacement-unmatched">0</strong><span>No migrables</span></article>',
        "</div>",
        '<section class="pdfjs-custom-replacement-section">',
        "<h3>Revision manual</h3>",
        '<div class="pdfjs-custom-replacement-list" id="pdfjs-custom-replacement-review-list"></div>',
        "</section>",
        '<section class="pdfjs-custom-replacement-section">',
        "<h3>No migrables</h3>",
        '<div class="pdfjs-custom-replacement-unmatched-list" id="pdfjs-custom-replacement-unmatched-list"></div>',
        "</section>",
        '<div class="pdfjs-custom-modal-actions">',
        '<button type="button" data-variant="ghost" id="pdfjs-custom-replacement-cancel">Cancelar</button>',
        '<button type="button" data-variant="primary" id="pdfjs-custom-replacement-confirm">Confirmar reemplazo</button>',
        "</div>",
        "</div>",
      ].join("");
      backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) {
          closeReplacementModal();
        }
      });
      document.body.appendChild(backdrop);
      state.replacementBackdrop = backdrop;
      state.replacementDescription = backdrop.querySelector("#pdfjs-custom-replacement-description");
      state.replacementAutoCount = backdrop.querySelector("#pdfjs-custom-replacement-auto");
      state.replacementReviewCount = backdrop.querySelector("#pdfjs-custom-replacement-review");
      state.replacementUnmatchedCount = backdrop.querySelector("#pdfjs-custom-replacement-unmatched");
      state.replacementReviewList = backdrop.querySelector("#pdfjs-custom-replacement-review-list");
      state.replacementUnmatchedList = backdrop.querySelector("#pdfjs-custom-replacement-unmatched-list");
      state.replacementConfirm = backdrop.querySelector("#pdfjs-custom-replacement-confirm");
      state.replacementCancel = backdrop.querySelector("#pdfjs-custom-replacement-cancel");
      state.replacementCancel.addEventListener("click", () => closeReplacementModal());
      state.replacementConfirm.addEventListener("click", () => {
        void commitReplacement();
      });
    }
  }

  function bindSyncButtons() {
    if (!state.syncButton) {
      state.syncButton = document.getElementById("syncButton");
      if (state.syncButton) {
        state.syncButton.addEventListener("click", () => {
          void syncAnnotatedPdf();
        });
      }
    }

    if (!state.secondarySyncButton) {
      state.secondarySyncButton = document.getElementById("secondarySyncButton");
      if (state.secondarySyncButton) {
        state.secondarySyncButton.addEventListener("click", () => {
          void syncAnnotatedPdf();
        });
      }
    }

    if (!state.replaceButton) {
      state.replaceButton = document.getElementById("replaceButton");
      if (state.replaceButton) {
        state.replaceButton.addEventListener("click", () => {
          openReplacementPicker();
        });
      }
    }

    if (!state.secondaryReplaceButton) {
      state.secondaryReplaceButton = document.getElementById("secondaryReplaceButton");
      if (state.secondaryReplaceButton) {
        state.secondaryReplaceButton.addEventListener("click", () => {
          openReplacementPicker();
        });
      }
    }

    refreshSyncButtons();
    refreshCutButton();
  }

  function refreshCutButton() {
    if (!(state.cutButton instanceof HTMLButtonElement)) return;
    state.cutButton.disabled =
      !state.app?.pdfDocument ||
      state.isExportingPageRange ||
      (isPresentationMode() && state.presentationPhase !== "ready");
    state.cutButton.classList.toggle("is-active", state.cutSelectionMode);
    state.cutButton.setAttribute("aria-pressed", state.cutSelectionMode ? "true" : "false");
    state.cutButton.title = state.cutSelectionMode
      ? state.cutStartPage == null
        ? "Selecciona la pagina inicial"
        : "Confirmar y descargar"
      : "Recortar paginas";
  }

  function setSyncButtonState(button) {
    if (!(button instanceof HTMLElement)) return;

    if (!canSyncCurrentDocument()) {
      button.hidden = true;
      return;
    }

    button.hidden = false;
    let nextState = "idle";
    if (state.isSyncing) {
      nextState = "syncing";
    } else if (state.hasUnsyncedChanges) {
      nextState = "dirty";
    } else if (state.isSynced) {
      nextState = "synced";
    }

    button.dataset.syncState = nextState;
    button.toggleAttribute("disabled", state.isSyncing || !state.hasUnsyncedChanges);
    button.setAttribute(
      "title",
      state.isSyncing
        ? "Sincronizando cambios"
        : state.hasUnsyncedChanges
          ? "Sincronizar cambios"
          : state.isSynced
            ? "Sincronizado"
            : "Sin cambios para sincronizar"
    );
  }

  function refreshSyncButtons() {
    if (!state.app) return;

    const hasUnsyncedChanges = hasUnsyncedAnnotations();
    state.hasUnsyncedChanges = hasUnsyncedChanges;
    if (hasUnsyncedChanges) {
      state.isSynced = false;
    }

    setSyncButtonState(state.syncButton);
    setSyncButtonState(state.secondarySyncButton);
    setReplaceButtonState(state.replaceButton);
    setReplaceButtonState(state.secondaryReplaceButton);
  }

  function setReplaceButtonState(button) {
    if (!(button instanceof HTMLElement)) return;

    if (!canReplaceMaterial()) {
      button.hidden = true;
      return;
    }

    button.hidden = false;
    const disabled = state.isSyncing || state.hasUnsyncedChanges;
    button.toggleAttribute("disabled", disabled);
    button.setAttribute(
      "title",
      state.isSyncing
        ? "Espera a que termine la sincronizacion"
        : state.hasUnsyncedChanges
          ? "Sincroniza antes de reemplazar el PDF"
          : "Reemplazar PDF"
    );
  }

  function clearExitSyncTimer() {
    if (state.exitSyncTimer) {
      window.clearTimeout(state.exitSyncTimer);
      state.exitSyncTimer = null;
    }
  }

  function applyEnhancedPdfReadability() {
    const canvases = document.querySelectorAll("#viewer .page canvas");
    canvases.forEach((canvas) => {
      canvas.style.filter = state.enhancedPdfReadability ? ENHANCED_PDF_CANVAS_FILTER : "";
    });
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
    if (state.statusTimer) {
      window.clearTimeout(state.statusTimer);
      state.statusTimer = null;
    }
    state.statusNode.textContent = message;
    state.statusNode.dataset.visible = "true";
  }

  function scheduleHideStatus(delay = 2200) {
    if (state.statusTimer) {
      window.clearTimeout(state.statusTimer);
    }
    state.statusTimer = window.setTimeout(() => {
      state.statusTimer = null;
      hideStatus();
    }, delay);
  }

  function hideStatus() {
    if (state.statusTimer) {
      window.clearTimeout(state.statusTimer);
      state.statusTimer = null;
    }
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
    const currentName =
      (isPresentationMode() && state.presentationFileName) ||
      state.query.fileName ||
      state.app?._docFilename ||
      "fragmento";
    return String(currentName).replace(/\.pdf$/i, "") || "fragmento";
  }

  function startCutSelection() {
    if (!state.app?.pdfDocument) {
      showToast("Primero carga un PDF.", "info");
      return;
    }
    if (state.isExportingPageRange) return;
    state.cutSelectionMode = true;
    state.cutStartPage = null;
    state.cutEndPage = null;
    refreshCutButton();
    refreshCutPageHighlights();
  }

  function cancelCutSelection() {
    state.cutSelectionMode = false;
    state.cutStartPage = null;
    state.cutEndPage = null;
    refreshCutButton();
    refreshCutPageHighlights();
  }

  function refreshCutPageHighlights() {
    const pages = document.querySelectorAll(
      "#viewer .page[data-page-number]"
    );
    pages.forEach((page) => {
      page.removeAttribute("data-cut-boundary");
      if (!state.cutSelectionMode) return;
      const pageNumber = Number.parseInt(page.getAttribute("data-page-number") || "", 10);
      const isStart = pageNumber === state.cutStartPage;
      const isEnd = pageNumber === state.cutEndPage;
      if (isStart && isEnd) {
        page.setAttribute("data-cut-boundary", "both");
      } else if (isStart) {
        page.setAttribute("data-cut-boundary", "start");
      } else if (isEnd) {
        page.setAttribute("data-cut-boundary", "end");
      }
    });
  }

  function getClickedCutPage(event) {
    if (!(event.target instanceof Element)) return null;
    const page = event.target.closest(
      "#viewer .page[data-page-number]"
    );
    if (!(page instanceof HTMLElement)) return null;
    const pageNumber = Number.parseInt(page.dataset.pageNumber || "", 10);
    return Number.isInteger(pageNumber) ? pageNumber : null;
  }

  function handleCutPageClick(event) {
    if (!state.cutSelectionMode || state.isExportingPageRange) return;
    const pageNumber = getClickedCutPage(event);
    if (!Number.isInteger(pageNumber)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    if (state.cutStartPage == null) {
      state.cutStartPage = pageNumber;
      state.cutEndPage = null;
      refreshCutButton();
      refreshCutPageHighlights();
      return;
    }

    if (state.cutEndPage == null) {
      const firstPage = state.cutStartPage;
      state.cutStartPage = Math.min(firstPage, pageNumber);
      state.cutEndPage = Math.max(firstPage, pageNumber);
      refreshCutButton();
      refreshCutPageHighlights();
      if (firstPage === pageNumber) {
        void submitPageRangeExport(state.cutStartPage, state.cutEndPage);
      }
      return;
    }

    state.cutStartPage = pageNumber;
    state.cutEndPage = null;
    refreshCutButton();
    refreshCutPageHighlights();
  }

  function handleCutButtonClick() {
    if (state.isExportingPageRange) return;
    if (!state.cutSelectionMode) {
      startCutSelection();
      return;
    }
    if (state.cutStartPage == null) {
      return;
    }
    void submitPageRangeExport(
      state.cutStartPage,
      state.cutEndPage == null ? state.cutStartPage : state.cutEndPage
    );
  }

  async function buildCopiedPageRangePdf(startPage, endPage) {
    if (!window.PDFLib?.PDFDocument) {
      throw new Error("pdf-lib no esta disponible en este visor.");
    }
    if (!state.app?.pdfDocument) {
      throw new Error("No hay un PDF cargado.");
    }

    const currentBytes =
      typeof state.app.pdfDocument.saveDocument === "function"
        ? await state.app.pdfDocument.saveDocument()
        : await state.app.pdfDocument.getData();
    const sourceDocument = await window.PDFLib.PDFDocument.load(currentBytes);
    const outputDocument = await window.PDFLib.PDFDocument.create();
    const pageIndices = [];
    for (let pageNumber = startPage; pageNumber <= endPage; pageNumber += 1) {
      pageIndices.push(pageNumber - 1);
    }
    const copiedPages = await outputDocument.copyPages(sourceDocument, pageIndices);
    for (const page of copiedPages) {
      outputDocument.addPage(page);
    }
    return outputDocument.save({ useObjectStreams: true });
  }

  function downloadPdfBytes(pdfBytes, fileName) {
    const blob = new Blob([pdfBytes], { type: "application/pdf" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = fileName;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  async function submitPageRangeExport(startPage, endPage) {
    if (state.isExportingPageRange) return;
    const pageCount = Number(state.app?.pdfDocument?.numPages || 0);
    if (
      !Number.isInteger(startPage) ||
      !Number.isInteger(endPage) ||
      startPage < 1 ||
      endPage < startPage ||
      endPage > pageCount
    ) {
      showToast("No se pudo determinar un rango de paginas valido.", "error");
      return;
    }

    state.isExportingPageRange = true;
    refreshCutButton();
    showBusy("Preparando paginas...");
    try {
      const pdfBytes = await buildCopiedPageRangePdf(startPage, endPage);
      const fileName = normalizePdfFileName(
        `${getDefaultBaseName()}_paginas-${startPage}-${endPage}`
      );
      downloadPdfBytes(pdfBytes, fileName);
    } catch (error) {
      console.error("Custom PDF.js rasterized range export failed:", error);
      showToast(
        error instanceof Error ? error.message : "No se pudo crear el PDF recortado.",
        "error",
        4600
      );
    } finally {
      state.isExportingPageRange = false;
      cancelCutSelection();
      hideBusy();
    }
  }

  function canUseFragmentUpload() {
    if (isPresentationMode()) {
      return false;
    }
    const query = state.query;
    return Boolean(
      query.subjectId &&
        query.subjectName &&
        /^\d{4}-\d{2}-\d{2}$/.test(query.sessionDate) &&
        Number.isInteger(query.weekNumber)
    );
  }

  function updateDraftOverlay() {
    if (!state.draftOverlay) return;
    const shouldShow = isDraftMode() && !state.app?.pdfDocument;
    state.draftOverlay.dataset.open = shouldShow ? "true" : "false";
  }

  function closeMaterialTagPanel() {
    if (!state.tagPanel) return;
    if (state.activeRegionTagId != null) return;
    state.tagPanel.dataset.open = "false";
    state.tagButton?.setAttribute("aria-expanded", "false");
    if (state.tagStatus) state.tagStatus.textContent = "";
    if (state.tagSuggestions) state.tagSuggestions.hidden = true;
    if (state.tagColorInput) state.tagColorInput.hidden = true;
    state.editingTagId = null;
  }

  function requestPresentationRegions() {
    if (
      !isPresentationMode() ||
      !state.app?.pdfDocument ||
      state.presentationPhase !== "source"
    ) {
      return;
    }
    state.presentationPhase = "loading-regions";
    state.presentationRegionsByTag.clear();
    state.presentationPendingTagIds = new Set(state.query.presentationTagIds);
    showLoadingOverlay("Cargando regiones...");
    for (const tagId of state.query.presentationTagIds) {
      postToParent({ type: "viewerRequestMaterialTagRegions", tagId });
    }
  }

  function collectPresentationRegions() {
    const regions = [];
    for (const tagId of state.query.presentationTagIds) {
      for (const region of state.presentationRegionsByTag.get(tagId) || []) {
        regions.push({ ...region, tagId });
      }
    }
    regions.sort((left, right) =>
      Number(left.pageNumber) - Number(right.pageNumber) ||
      Number(left.y1) - Number(right.y1) ||
      Number(left.x1) - Number(right.x1) ||
      Number(left.orderIndex || 0) - Number(right.orderIndex || 0)
    );
    return regions;
  }

  async function appendCroppedPdfPage(outputDocument, sourcePage, selection) {
    const cropBox = sourcePage.getCropBox();
    const cropLeft = cropBox.x || 0;
    const cropBottom = cropBox.y || 0;
    const cropWidth = cropBox.width || sourcePage.getWidth();
    const cropHeight = cropBox.height || sourcePage.getHeight();
    const normalizedBounds = getNormalizedBoundsForSelection(selection);
    const left = cropLeft + normalizedBounds.left * cropWidth;
    const right = cropLeft + normalizedBounds.right * cropWidth;
    const top = cropBottom + cropHeight - normalizedBounds.top * cropHeight;
    const bottom = cropBottom + cropHeight - normalizedBounds.bottom * cropHeight;
    const width = Math.max(1, right - left);
    const height = Math.max(1, top - bottom);
    const pageRotation = typeof selection.pageRotation === "number" ? selection.pageRotation : 0;
    const embeddedPage = await outputDocument.embedPage(sourcePage, {
      left,
      right,
      bottom,
      top,
    });
    const rotated = pageRotation === 90 || pageRotation === 270;
    const outputPage = outputDocument.addPage(rotated ? [height, width] : [width, height]);

    if (pageRotation === 90) {
      outputPage.drawPage(embeddedPage, {
        x: 0,
        y: width,
        width,
        height,
        rotate: window.PDFLib.degrees(270),
      });
    } else if (pageRotation === 180) {
      outputPage.drawPage(embeddedPage, {
        x: width,
        y: height,
        width,
        height,
        rotate: window.PDFLib.degrees(180),
      });
    } else if (pageRotation === 270) {
      outputPage.drawPage(embeddedPage, {
        x: height,
        y: 0,
        width,
        height,
        rotate: window.PDFLib.degrees(90),
      });
    } else {
      outputPage.drawPage(embeddedPage, {
        x: 0,
        y: 0,
        width,
        height,
      });
    }
  }

  async function buildPresentationPdf(regions) {
    if (!regions.length) {
      throw new Error("No hay regiones guardadas para las etiquetas activas.");
    }
    if (!window.PDFLib?.PDFDocument) {
      throw new Error("pdf-lib no esta disponible en este visor.");
    }
    const sourceDocument = await ensureSourcePdfDoc();
    const outputDocument = await window.PDFLib.PDFDocument.create();
    for (let index = 0; index < regions.length; index += 1) {
      const region = regions[index];
      if (state.presentationPhase !== "building") {
        throw new Error("La generacion de la presentacion fue cancelada.");
      }
      if (state.loadingText) {
        state.loadingText.textContent = `Preparando region ${index + 1} de ${regions.length}...`;
      }
      const pageNumber = Number(region.pageNumber);
      const sourcePage = sourceDocument.getPage(pageNumber - 1);
      if (!sourcePage) {
        throw new Error(`No se pudo leer la pagina ${pageNumber}.`);
      }
      await appendCroppedPdfPage(outputDocument, sourcePage, {
        pageNum: pageNumber,
        pageRotation: Number(region.pageRotation || 0),
        xp1: Number(region.x1),
        yp1: Number(region.y1),
        xp2: Number(region.x2),
        yp2: Number(region.y2),
      });
    }
    return outputDocument.save({ useObjectStreams: true });
  }

  async function openPresentationDocument() {
    if (
      !isPresentationMode() ||
      state.presentationPendingTagIds.size > 0 ||
      state.presentationPhase !== "loading-regions"
    ) {
      return;
    }

    state.presentationPhase = "building";
    showLoadingOverlay("Preparando presentacion...");
    try {
      const regions = collectPresentationRegions();
      const pdfBytes = await buildPresentationPdf(regions);
      const fileName = normalizePdfFileName(`${getDefaultBaseName()}_presentacion`);
      state.presentationFileName = fileName;
      state.presentationScaleInitialized = false;
      state.presentationPhase = "opening";
      await state.app.open({
        data: pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes),
        filename: fileName,
      });
    } catch (error) {
      state.presentationPhase = "error";
      console.error("Custom PDF.js presentation generation failed:", error);
      document.documentElement.classList.add("pdfjs-custom-presentation-preparing");
      showLoadingOverlay(
        error instanceof Error ? error.message : "No se pudo preparar la presentacion."
      );
    }
  }

  function renderMaterialTags() {
    if (!state.tagList) return;
    state.tagList.replaceChildren();
    for (const tag of state.tagCatalog.filter((candidate) => state.assignedTagIds.has(candidate.id))) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "pdfjs-custom-tag-chip";
      const regionCount = Number(state.tagRegionCounts?.[String(tag.id)] || 0);
      const isActive = state.activeRegionTagId === tag.id;
      chip.textContent = `${isActive ? "Guardar " : ""}#${tag.name || "tag"} · ${isActive ? state.selections.length : regionCount}`;
      chip.title = isActive
        ? `Guardar ${state.selections.length} regiones de #${tag.name}`
        : `Marcar regiones para #${tag.name}`;
      chip.classList.toggle("is-active", isActive);
      if (typeof tag.color === "string" && tag.color) {
        chip.style.borderColor = tag.color;
      }
      chip.addEventListener("click", () => {
        if (state.activeRegionTagId === tag.id) {
          if (state.tagStatus) state.tagStatus.textContent = "Guardando regiones...";
          postToParent({
            type: "viewerSaveMaterialTagRegions",
            tagId: tag.id,
            regions: state.selections.map((selection, orderIndex) => ({
              pageNumber: selection.pageNum,
              pageRotation: selection.pageRotation || 0,
              x1: selection.xp1,
              y1: selection.yp1,
              x2: selection.xp2,
              y2: selection.yp2,
              orderIndex,
            })),
          });
          return;
        }
        if (state.activeRegionTagId != null) {
          showToast("Guarda o cancela el tag activo antes de elegir otro.", "info");
          return;
        }
        if (state.tagStatus) state.tagStatus.textContent = `Cargando regiones de #${tag.name}...`;
        postToParent({ type: "viewerRequestMaterialTagRegions", tagId: tag.id });
      });
      state.tagList.appendChild(chip);

      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "pdfjs-custom-tag-edit";
      edit.textContent = "…";
      edit.title = `Editar #${tag.name}`;
      edit.setAttribute("aria-label", `Editar #${tag.name}`);
      edit.addEventListener("click", () => openMaterialTagEditor(tag));
      state.tagList.appendChild(edit);
    }
  }

  function renderMaterialTagSuggestions() {
    if (!state.tagSuggestions || !state.tagInput) return;
    if (state.editingTagId != null) {
      state.tagSuggestions.hidden = true;
      return;
    }

    const query = state.tagInput.value.replace(/^#/, "").trim().toLocaleLowerCase();
    const matches = query
      ? state.tagCatalog.filter((tag) => tag.name.toLocaleLowerCase().includes(query)).slice(0, 5)
      : [];
    state.tagSuggestions.replaceChildren();
    for (const tag of matches) {
      const option = document.createElement("button");
      option.type = "button";
      option.textContent = `#${tag.name}`;
      option.style.setProperty("--tag-color", tag.color || "#0f766e");
      option.addEventListener("click", () => {
        state.tagInput.value = tag.name;
        state.tagSuggestions.hidden = true;
        submitMaterialTag();
      });
      state.tagSuggestions.appendChild(option);
    }
    state.tagSuggestions.hidden = matches.length === 0;
  }

  function openMaterialTagEditor(tag) {
    if (!state.tagInput || !state.tagColorInput || !state.tagPanel) return;
    state.editingTagId = tag.id;
    state.tagInput.value = tag.name || "";
    state.tagColorInput.value = tag.color || "#10b981";
    state.tagColorInput.hidden = false;
    state.tagPanel.querySelector('button[type="submit"]').textContent = "Guardar";
    if (state.tagSuggestions) state.tagSuggestions.hidden = true;
    state.tagInput.focus();
  }

  function resetMaterialTagEditor() {
    state.editingTagId = null;
    if (state.tagColorInput) state.tagColorInput.hidden = true;
    state.tagPanel?.querySelector('button[type="submit"]').replaceChildren("Agregar");
  }

  function toggleMaterialTagPanel() {
    if (!state.tagPanel || !state.tagInput) return;
    if (!Number.isInteger(state.query?.materialId)) {
      showToast("Abre un PDF guardado para poder asignarle tags.", "info");
      return;
    }

    const isOpen = state.tagPanel.dataset.open === "true";
    if (isOpen) {
      closeMaterialTagPanel();
      return;
    }

    state.tagPanel.dataset.open = "true";
    state.tagButton?.setAttribute("aria-expanded", "true");
    resetMaterialTagEditor();
    state.tagInput.value = "";
    if (state.tagStatus) state.tagStatus.textContent = "";
    postToParent({ type: "viewerRequestMaterialTags" });
    window.setTimeout(() => state.tagInput?.focus(), 0);
  }

  function submitMaterialTag() {
    const name = state.tagInput?.value || "";
    if (!name.trim()) {
      if (state.tagStatus) state.tagStatus.textContent = "Escribe un tag.";
      state.tagInput?.focus();
      return;
    }

    if (state.tagStatus) state.tagStatus.textContent = "Guardando...";
    if (state.editingTagId != null) {
      postToParent({
        type: "viewerUpdateMaterialTag",
        tagId: state.editingTagId,
        name,
        color: state.tagColorInput?.value || "#10b981",
      });
      return;
    }
    postToParent({ type: "viewerRequestMaterialTag", name });
  }

  function getCurrentViewerLocation() {
    const currentScaleValue = state.app?.pdfViewer?.currentScaleValue;
    const currentPageNumber = state.app?.pdfViewer?.currentPageNumber;
    const pagesRotation = state.app?.pdfViewer?.pagesRotation;
    const pdfOpenParams = state.app?.pdfViewer?._location?.pdfOpenParams || "";

    return {
      currentScaleValue: typeof currentScaleValue === "string" ? currentScaleValue : null,
      currentPageNumber: Number.isInteger(currentPageNumber) ? currentPageNumber : null,
      pagesRotation: Number.isFinite(pagesRotation) ? pagesRotation : null,
      pdfOpenParams: typeof pdfOpenParams === "string" ? pdfOpenParams : "",
    };
  }

  function restoreViewerLocation(location) {
    if (!location || !state.app?.pdfViewer) {
      return;
    }

    window.setTimeout(() => {
      try {
        if (Number.isFinite(location.pagesRotation)) {
          state.app.pdfViewer.pagesRotation = location.pagesRotation;
        }
        if (location.currentScaleValue) {
          state.app.pdfViewer.currentScaleValue = location.currentScaleValue;
        }
        if (Number.isInteger(location.currentPageNumber)) {
          state.app.pdfViewer.currentPageNumber = location.currentPageNumber;
        }
        if (location.pdfOpenParams) {
          const nextHash = location.pdfOpenParams.startsWith("#")
            ? location.pdfOpenParams.slice(1)
            : location.pdfOpenParams;
          state.app.pdfLinkService?.setHash?.(nextHash);
        }
      } catch (error) {
        console.warn("Custom PDF.js could not restore viewer location:", error);
      }
    }, 0);
  }

  async function reopenDocumentInViewer(pdfBytes, fileName) {
    if (!state.app?.open || !pdfBytes) {
      throw new Error("No se pudo reabrir el PDF en caliente.");
    }

    const previousLocation = getCurrentViewerLocation();
    showLoadingOverlay("Actualizando PDF...");
    closeReplacementModal();

    const uint8Bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
    await state.app.open({
      data: uint8Bytes,
      filename: fileName || state.query.fileName || "material.pdf",
    });
    refreshDocumentViewerMetadata();
    restoreViewerLocation(previousLocation);
  }

  function buildReturnHref() {
    return state.query?.returnToken ? `/?returnToken=${encodeURIComponent(state.query.returnToken)}` : "/";
  }

  function isInlineViewerMode() {
    return state.query?.viewerMode === "inline";
  }

  async function navigateBackToApp() {
    if (state.isSyncing) {
      showToast("Espera a que termine la sincronizacion.", "info");
      return;
    }

    if (canSyncCurrentDocument() && hasUnsyncedAnnotations()) {
      const synced = await syncAnnotatedPdf();
      if (!synced) {
        return;
      }
    }

    state.pendingExitSync = false;
    state.suppressUnloadSync = true;
    clearExitSyncTimer();
    if (isInlineViewerMode()) {
      postToParent({ type: "viewerRequestClose" });
      return;
    }
    window.location.assign(buildReturnHref());
  }

  function handleViewerEscape(event) {
    if (event?.defaultPrevented) return;

    if (state.cutSelectionMode) {
      event?.preventDefault?.();
      cancelCutSelection();
      return;
    }

    if (state.replacementBackdrop?.dataset.open === "true") {
      event?.preventDefault?.();
      closeReplacementModal();
      return;
    }

    if (state.modal?.dataset.open === "true") {
      event?.preventDefault?.();
      closeModal();
      return;
    }

    if (state.activeRegionTagId != null) {
      event?.preventDefault?.();
      state.activeRegionTagId = null;
      state.activeRegionTagName = "";
      clearSelections();
      leaveSelectionMode("Cambios de regiones cancelados.");
      renderMaterialTags();
      if (state.tagStatus) state.tagStatus.textContent = "";
      return;
    }

    if (state.selectionMode) {
      event?.preventDefault?.();
      leaveSelectionMode("Seleccion cancelada.");
      return;
    }

    // Escape belongs to PDF.js (notably to leave presentation/fullscreen mode).
    // Closing the viewer is an explicit navigation action, never an Escape side effect.
    event?.preventDefault?.();
  }

  function showLoadingOverlay(message) {
    ensureUi();
    if (state.loadingText) {
      state.loadingText.textContent = message || "Cargando PDF...";
    }
    if (state.loadingOverlay) {
      state.loadingOverlay.dataset.open = "true";
    }
  }

  function hideLoadingOverlay() {
    if (state.loadingOverlay) {
      state.loadingOverlay.dataset.open = "false";
    }
  }

  function clearSelections() {
    state.selections = [];
    refreshLayers();
  }

  function clearPageTextModels() {
    state.pageTextModels = new Map();
  }

  function enterSelectionMode() {
    if (!state.app?.pdfDocument) {
      showToast("Primero carga un PDF.", "info");
      return;
    }
    clearSelections();
    state.activeRegionTagId = null;
    state.activeRegionTagName = "";
    state.selectionMode = true;
    refreshLayers();
    showStatus("Modo seleccion activo. Delimita areas y luego pulsa Ctrl+M.");
    showToast("Modo seleccion activado.", "info");
  }

  function leaveSelectionMode(message) {
    const wasSelectionMode = state.selectionMode;
    state.selectionMode = false;
    state.drag = null;
    refreshLayers();
    if (wasSelectionMode) {
      hideStatus();
    }
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
            if (state.activeRegionTagId != null) renderMaterialTags();
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
          if (state.activeRegionTagId != null) renderMaterialTags();
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
    refreshCutPageHighlights();
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

  function notifySubjectDayMaterialsRefresh() {
    if (isCronogramaResource()) {
      return;
    }

    const payload = {
      subjectId: state.query.subjectId,
      sessionDate: state.query.sessionDate,
      weekNumber: state.query.weekNumber,
      timestamp: Date.now(),
    };

    try {
      const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("subject-day-materials") : null;
      channel?.postMessage(payload);
      channel?.close();
    } catch {}

    try {
      window.localStorage.setItem("subject-day-materials:refresh", JSON.stringify(payload));
    } catch {}
  }

  function markDocumentAsSynced() {
    const annotationStorage = state.app?.pdfDocument?.annotationStorage;
    annotationStorage?.resetModified?.();
    annotationStorage?.resetModifiedIds?.();
    if (state.app) {
      state.app._annotationStorageModified = false;
      delete state.app._annotationStorageModified;
    }
    state.hasUnsyncedChanges = false;
    state.isSynced = true;
    state.pendingExitSync = false;
    refreshSyncButtons();
  }

  function refreshDocumentViewerMetadata() {
    if (!state.app) return;

    const fileUrl = getCurrentFileUrl();
    if (fileUrl) {
      state.app.setTitleUsingUrl(fileUrl, fileUrl);
    }
    if (state.query.fileName) {
      state.app._contentDispositionFilename = state.query.fileName;
      state.app.setTitle(state.query.fileName);
    }
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function normalizeContextSnippet(value, takeFromEnd = false) {
    const normalized = normalizeText(value);
    if (!normalized) return "";
    return takeFromEnd ? normalized.slice(-MAX_CONTEXT_LENGTH) : normalized.slice(0, MAX_CONTEXT_LENGTH);
  }

  function normalizeNumberArray(value) {
    if (Array.isArray(value)) {
      return value.map((item) => Number(item)).filter((item) => Number.isFinite(item));
    }
    if (ArrayBuffer.isView(value)) {
      return Array.from(value, (item) => Number(item)).filter((item) => Number.isFinite(item));
    }
    return [];
  }

  function normalizeColor(value) {
    const numbers = normalizeNumberArray(value).slice(0, 3);
    if (numbers.length !== 3) return [...DEFAULT_HIGHLIGHT_COLOR];
    return numbers;
  }

  function clampOpacity(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return DEFAULT_HIGHLIGHT_OPACITY;
    return Math.max(0, Math.min(1, numeric));
  }

  function quadPointsToRects(quadPoints) {
    const rects = [];
    for (let index = 0; index + 7 < quadPoints.length; index += 8) {
      const xs = [quadPoints[index], quadPoints[index + 2], quadPoints[index + 4], quadPoints[index + 6]];
      const ys = [quadPoints[index + 1], quadPoints[index + 3], quadPoints[index + 5], quadPoints[index + 7]];
      rects.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
    }
    return rects;
  }

  function rectsIntersect(left, right) {
    return !(left[2] < right[0] || right[2] < left[0] || left[3] < right[1] || right[3] < left[1]);
  }

  function getTokenRect(item) {
    const transform = Array.isArray(item.transform) ? item.transform.map((entry) => Number(entry)) : [];
    const width = Number(item.width);
    const height = Number(item.height);
    if (transform.length < 6 || !Number.isFinite(width) || !Number.isFinite(height)) {
      return null;
    }

    const x1 = transform[4];
    const y2 = transform[5];
    const x2 = x1 + width;
    const y1 = y2 - height;
    if (![x1, y1, x2, y2].every((entry) => Number.isFinite(entry))) {
      return null;
    }

    return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
  }

  async function buildPageTextModelFromPage(pageIndex, page) {
    const textContent = await page.getTextContent();
    const tokens = [];
    let text = "";

    for (const item of textContent.items || []) {
      const tokenText = normalizeText(item.str || "");
      const rect = getTokenRect(item);
      if (!tokenText || !rect) {
        continue;
      }

      if (text.length > 0) {
        text += " ";
      }

      const start = text.length;
      text += tokenText;
      const end = text.length;
      tokens.push({
        text: tokenText,
        start,
        end,
        rect,
      });
    }

    return {
      pageIndex,
      text,
      tokens,
      pageRect: Array.isArray(page.view) ? [page.view[0], page.view[1], page.view[2], page.view[3]] : [0, 0, 0, 0],
    };
  }

  async function getDocumentPageTextModel(pdfDocument, pageIndex, cache = null) {
    if (cache?.has(pageIndex)) {
      return cache.get(pageIndex);
    }

    const page = await pdfDocument.getPage(pageIndex + 1);
    const model = await buildPageTextModelFromPage(pageIndex, page);
    cache?.set(pageIndex, model);
    return model;
  }

  async function getPageTextModel(pageIndex) {
    if (!state.app?.pdfDocument) {
      throw new Error("Primero carga un PDF.");
    }

    return getDocumentPageTextModel(state.app.pdfDocument, pageIndex, state.pageTextModels);
  }

  function getHighlightTokenIndexesFromQuads(pageModel, quadPoints) {
    const quadRects = quadPointsToRects(quadPoints);
    const indexes = [];
    pageModel.tokens.forEach((token, index) => {
      if (quadRects.some((quadRect) => rectsIntersect(quadRect, token.rect))) {
        indexes.push(index);
      }
    });
    return indexes;
  }

  function extractQuoteFromTokenIndexes(pageModel, tokenIndexes) {
    if (!tokenIndexes.length) return null;

    const startToken = pageModel.tokens[tokenIndexes[0]];
    const endToken = pageModel.tokens[tokenIndexes[tokenIndexes.length - 1]];
    if (!startToken || !endToken) return null;

    const exactQuote = normalizeText(tokenIndexes.map((index) => pageModel.tokens[index]?.text || "").join(" "));
    if (!exactQuote) return null;

    return {
      exactQuote,
      prefixQuote: normalizeContextSnippet(
        pageModel.text.slice(Math.max(0, startToken.start - MAX_CONTEXT_LENGTH), startToken.start),
        true
      ),
      suffixQuote: normalizeContextSnippet(pageModel.text.slice(endToken.end, endToken.end + MAX_CONTEXT_LENGTH)),
    };
  }

  function buildSnapshotItem({
    annotationId,
    pageIndex,
    rect,
    quadPoints,
    color,
    opacity,
    exactQuote,
    prefixQuote,
    suffixQuote,
    sourceFingerprint,
  }) {
    return {
      annotationId: String(annotationId),
      pageIndex,
      rect: normalizeNumberArray(rect).slice(0, 4),
      quadPoints: [...quadPoints],
      color: normalizeColor(color),
      opacity: clampOpacity(opacity),
      exactQuote: normalizeText(exactQuote),
      prefixQuote: normalizeContextSnippet(prefixQuote, true),
      suffixQuote: normalizeContextSnippet(suffixQuote),
      sourceFingerprint: String(sourceFingerprint || ""),
    };
  }

  async function extractHighlightSnapshotFromDocument(pdfDocument, explicitFingerprint = "", cache = null) {
    const sourcePdfFingerprint = explicitFingerprint || pdfDocument?.fingerprints?.[0] || "";
    const snapshot = [];
    const unmatched = [];

    for (let pageIndex = 0; pageIndex < (pdfDocument?.numPages || 0); pageIndex += 1) {
      const page = await pdfDocument.getPage(pageIndex + 1);
      const pageModel = await getDocumentPageTextModel(pdfDocument, pageIndex, cache);
      const annotations = await page.getAnnotations();

      annotations.forEach((annotation, annotationIndex) => {
        const subtype = String(annotation.subtype || "").toLowerCase();
        const quadPoints = normalizeNumberArray(annotation.quadPoints);
        if (subtype !== "highlight" || !quadPoints.length) {
          return;
        }

        const quote = extractQuoteFromTokenIndexes(pageModel, getHighlightTokenIndexesFromQuads(pageModel, quadPoints));
        const snapshotItem = buildSnapshotItem({
          annotationId: annotation.id || `legacy-${pageIndex + 1}-${annotationIndex + 1}`,
          pageIndex,
          rect: annotation.rect,
          quadPoints,
          color: annotation.color,
          opacity: annotation.opacity,
          exactQuote: quote?.exactQuote || "",
          prefixQuote: quote?.prefixQuote || "",
          suffixQuote: quote?.suffixQuote || "",
          sourceFingerprint: sourcePdfFingerprint,
        });

        if (!quote?.exactQuote) {
          unmatched.push({
            highlight: snapshotItem,
            reason: "No se pudo reconstruir texto confiable desde el PDF actual.",
          });
          return;
        }

        snapshot.push(snapshotItem);
      });
    }

    return {
      sourcePdfFingerprint,
      snapshot,
      unmatched,
    };
  }

  async function buildHighlightSnapshot() {
    const serializableMap = state.app?.pdfDocument?.annotationStorage?.serializable?.map;
    const entries = serializableMap instanceof Map ? Array.from(serializableMap.entries()) : [];
    const sourcePdfFingerprint = state.app?.pdfDocument?.fingerprints?.[0] || "";
    const snapshot = [];

    for (const [annotationId, rawValue] of entries) {
      if (!rawValue || rawValue.deleted) continue;

      const quadPoints = normalizeNumberArray(rawValue.quadPoints);
      const pageIndex = Number(rawValue.pageIndex);
      if (!quadPoints.length || !Number.isInteger(pageIndex)) {
        continue;
      }

      const pageModel = await getPageTextModel(pageIndex);
      const quote = extractQuoteFromTokenIndexes(pageModel, getHighlightTokenIndexesFromQuads(pageModel, quadPoints));
      snapshot.push(
        buildSnapshotItem({
          annotationId,
          pageIndex,
          rect: rawValue.rect,
          quadPoints,
          color: rawValue.color,
          opacity: rawValue.opacity,
          exactQuote: quote?.exactQuote || "",
          prefixQuote: quote?.prefixQuote || "",
          suffixQuote: quote?.suffixQuote || "",
          sourceFingerprint: sourcePdfFingerprint,
        })
      );
    }

    return {
      sourcePdfFingerprint,
      snapshot,
      unmatched: [],
    };
  }

  async function buildSourceHighlightSnapshotForReplacement() {
    const draftSnapshot = await buildHighlightSnapshot();
    if (draftSnapshot.snapshot.length) {
      return draftSnapshot;
    }

    if (!state.app?.pdfDocument) {
      throw new Error("Primero carga un PDF.");
    }

    return extractHighlightSnapshotFromDocument(
      state.app.pdfDocument,
      state.app.pdfDocument?.fingerprints?.[0] || "",
      new Map()
    );
  }

  function pageDistanceScore(distance) {
    if (distance === 0) return 10;
    if (distance === 1) return 8;
    return 0;
  }

  function buildCandidateReason(prefixMatch, suffixMatch, pageDistance) {
    const pageReason = pageDistance === 0 ? "misma pagina" : pageDistance === 1 ? "pagina cercana" : "pagina distinta";
    if (prefixMatch && suffixMatch) return `Coincide el texto exacto y ambos contextos en ${pageReason}.`;
    if (prefixMatch || suffixMatch) return `Coincide el texto exacto y un contexto en ${pageReason}.`;
    return `Coincide el texto exacto sin contexto fuerte en ${pageReason}.`;
  }

  function buildOccurrenceCandidate(highlight, pageModel, occurrenceIndex) {
    const occurrenceEnd = occurrenceIndex + highlight.exactQuote.length;
    const tokenIndexes = pageModel.tokens.flatMap((token, tokenIndex) =>
      token.end <= occurrenceIndex || token.start >= occurrenceEnd ? [] : [tokenIndex]
    );

    if (!tokenIndexes.length) {
      return null;
    }

    const tokenRects = tokenIndexes.map((tokenIndex) => pageModel.tokens[tokenIndex].rect);
    const lineRects = [];
    for (const rect of tokenRects) {
      const centerY = (rect[1] + rect[3]) / 2;
      const existingLine = lineRects.find(
        (lineRect) => Math.abs((lineRect[1] + lineRect[3]) / 2 - centerY) <= Math.max(4, (rect[3] - rect[1]) * 0.75)
      );
      if (existingLine) {
        existingLine[0] = Math.min(existingLine[0], rect[0]);
        existingLine[1] = Math.min(existingLine[1], rect[1]);
        existingLine[2] = Math.max(existingLine[2], rect[2]);
        existingLine[3] = Math.max(existingLine[3], rect[3]);
      } else {
        lineRects.push([...rect]);
      }
    }

    lineRects.sort((left, right) => right[3] - left[3] || left[0] - right[0]);
    const quadPoints = lineRects.flatMap(([x1, y1, x2, y2]) => [x1, y2, x2, y2, x1, y1, x2, y1]);
    const rect = [
      Math.min(...lineRects.map((lineRect) => lineRect[0])),
      Math.min(...lineRects.map((lineRect) => lineRect[1])),
      Math.max(...lineRects.map((lineRect) => lineRect[2])),
      Math.max(...lineRects.map((lineRect) => lineRect[3])),
    ];
    const pageDistance = Math.abs(pageModel.pageIndex - highlight.pageIndex);
    const prefixSample = normalizeContextSnippet(
      pageModel.text.slice(Math.max(0, occurrenceIndex - highlight.prefixQuote.length), occurrenceIndex),
      true
    );
    const suffixSample = normalizeContextSnippet(
      pageModel.text.slice(occurrenceEnd, occurrenceEnd + highlight.suffixQuote.length)
    );
    const prefixMatch = Boolean(highlight.prefixQuote) && prefixSample === highlight.prefixQuote;
    const suffixMatch = Boolean(highlight.suffixQuote) && suffixSample === highlight.suffixQuote;

    return {
      highlight,
      candidate: {
        pageIndex: pageModel.pageIndex,
        rect,
        quadPoints,
        exactQuote: highlight.exactQuote,
        prefixMatch,
        suffixMatch,
        pageDistance,
      },
      score: 50 + (prefixMatch ? 15 : 0) + (suffixMatch ? 15 : 0) + pageDistanceScore(pageDistance),
      reason: buildCandidateReason(prefixMatch, suffixMatch, pageDistance),
    };
  }

  function listSearchPageIndexes(totalPages, pageIndex) {
    const preferred = [pageIndex, pageIndex - 1, pageIndex + 1].filter(
      (candidatePageIndex) => candidatePageIndex >= 0 && candidatePageIndex < totalPages
    );
    const rest = Array.from({ length: totalPages }, (_, index) => index).filter((index) => !preferred.includes(index));
    return [...preferred, ...rest];
  }

  function findMatchesForHighlight(highlight, pageModels) {
    const searchPageIndexes = listSearchPageIndexes(pageModels.length, highlight.pageIndex);
    const matches = [];

    for (const pageIndex of searchPageIndexes) {
      const model = pageModels[pageIndex];
      if (!model?.text) continue;

      let searchOffset = 0;
      while (true) {
        const occurrenceIndex = model.text.indexOf(highlight.exactQuote, searchOffset);
        if (occurrenceIndex === -1) break;
        const candidate = buildOccurrenceCandidate(highlight, model, occurrenceIndex);
        if (candidate) {
          matches.push(candidate);
        }
        searchOffset = occurrenceIndex + highlight.exactQuote.length;
      }
    }

    matches.sort((left, right) => right.score - left.score || left.candidate.pageDistance - right.candidate.pageDistance);
    return matches;
  }

  function isSelectablePdf(pageModels) {
    const textLength = pageModels.reduce((total, model) => total + model.text.length, 0);
    return textLength >= MIN_SELECTABLE_TEXT && pageModels.some((model) => model.tokens.length > 0);
  }

  function mergePreviewUnmatched(preview, legacyUnmatched, sourceHighlights) {
    const unmatched = [...legacyUnmatched, ...(preview.unmatched || [])];
    return {
      ...preview,
      unmatched,
      summary: {
        totalHighlights: sourceHighlights.length + legacyUnmatched.length,
        autoMatches: preview.autoMatches.length,
        reviewMatches: preview.reviewMatches.length,
        unmatched: unmatched.length,
      },
    };
  }

  async function openPdfDocumentInMemory(pdfBytes) {
    const pdfjsLib = window.pdfjsLib;
    if (!pdfjsLib?.getDocument) {
      throw new Error("PDF.js no esta disponible para analizar el reemplazo.");
    }

    const loadingTask = pdfjsLib.getDocument({
      data: pdfBytes,
      disableWorker: true,
      isEvalSupported: false,
      useSystemFonts: true,
    });
    const pdfDocument = await loadingTask.promise;
    return { pdfjsLib, pdfDocument };
  }

  async function buildReplacementPreviewInMemory({ sourceHighlights, candidatePdfBytes, candidateFileName, sourceFingerprint }) {
    const { pdfDocument } = await openPdfDocumentInMemory(candidatePdfBytes);

    try {
      const pageTextCache = new Map();
      const pageModels = await Promise.all(
        Array.from({ length: pdfDocument.numPages }, (_, pageIndex) =>
          getDocumentPageTextModel(pdfDocument, pageIndex, pageTextCache)
        )
      );

      if (!isSelectablePdf(pageModels)) {
        throw new Error("El PDF nuevo no tiene texto seleccionable suficiente para migrar resaltados.");
      }

      const autoMatches = [];
      const reviewMatches = [];
      const unmatched = [];
      const candidateFingerprint = pdfDocument.fingerprints?.[0] || "";

      for (const highlight of sourceHighlights) {
        if (!highlight.exactQuote) {
          unmatched.push({
            highlight,
            reason: "El highlight no tiene texto base para buscar en la nueva version.",
          });
          continue;
        }

        const bestMatch = findMatchesForHighlight(highlight, pageModels)[0];
        if (!bestMatch) {
          unmatched.push({
            highlight,
            reason: "No se encontro el texto exacto en el PDF nuevo.",
          });
          continue;
        }

        if (bestMatch.score >= 85) {
          autoMatches.push(bestMatch);
        } else if (bestMatch.score >= 60) {
          reviewMatches.push(bestMatch);
        } else {
          unmatched.push({
            highlight,
            reason: bestMatch.reason,
          });
        }
      }

      return {
        candidateFileName,
        sourceFingerprint,
        candidateFingerprint,
        autoMatches,
        reviewMatches,
        unmatched,
        summary: {
          totalHighlights: sourceHighlights.length,
          autoMatches: autoMatches.length,
          reviewMatches: reviewMatches.length,
          unmatched: unmatched.length,
        },
      };
    } finally {
      await pdfDocument.destroy?.();
    }
  }

  function getHighlightBoxesFromQuadPoints(quadPoints, pageRect) {
    const pageWidth = pageRect[2] - pageRect[0];
    const pageHeight = pageRect[3] - pageRect[1];
    const boxes = [];

    for (let index = 0; index + 7 < quadPoints.length; index += 8) {
      const left = quadPoints[index];
      const top = quadPoints[index + 1];
      const right = quadPoints[index + 2];
      const bottom = quadPoints[index + 5];
      boxes.push({
        x: (left - pageRect[0]) / pageWidth,
        y: 1 - (top - pageRect[1]) / pageHeight,
        width: (right - left) / pageWidth,
        height: (top - bottom) / pageHeight,
      });
    }

    return boxes;
  }

  function buildMigratedSnapshot(matches, candidateFingerprint) {
    return matches.map((match) =>
      buildSnapshotItem({
        annotationId: match.highlight.annotationId,
        pageIndex: match.candidate.pageIndex,
        rect: match.candidate.rect,
        quadPoints: match.candidate.quadPoints,
        color: match.highlight.color,
        opacity: match.highlight.opacity,
        exactQuote: match.highlight.exactQuote,
        prefixQuote: match.highlight.prefixQuote,
        suffixQuote: match.highlight.suffixQuote,
        sourceFingerprint: candidateFingerprint,
      })
    );
  }

  async function applyHighlightMigrationInMemory({ candidatePdfBytes, matches, candidateFingerprint }) {
    if (!matches.length) {
      return {
        pdfBytes: candidatePdfBytes,
        snapshot: [],
        candidateFingerprint: candidateFingerprint || "",
      };
    }

    const { pdfjsLib, pdfDocument } = await openPdfDocumentInMemory(candidatePdfBytes);

    try {
      const annotationStorage = pdfDocument.annotationStorage;
      const HighlightOutliner = globalThis._pdfjsTestingUtils?.HighlightOutliner;
      if (
        !annotationStorage ||
        typeof annotationStorage.setValue !== "function" ||
        typeof pdfDocument.saveDocument !== "function" ||
        typeof HighlightOutliner !== "function"
      ) {
        throw new Error("PDF.js no expone la serializacion necesaria para reaplicar highlights.");
      }

      const pageRects = new Map();
      for (const match of matches) {
        if (!pageRects.has(match.candidate.pageIndex)) {
          const page = await pdfDocument.getPage(match.candidate.pageIndex + 1);
          pageRects.set(match.candidate.pageIndex, [page.view[0], page.view[1], page.view[2], page.view[3]]);
        }

        const pageRect = pageRects.get(match.candidate.pageIndex);
        const boxes = getHighlightBoxesFromQuadPoints(match.candidate.quadPoints, pageRect);
        const outliner = new HighlightOutliner(boxes, 0.001);
        const outlines = outliner.getOutlines().serialize(match.candidate.rect, 0);
        annotationStorage.setValue(`migrated-${match.highlight.annotationId}`, {
          annotationType: pdfjsLib.AnnotationEditorType.HIGHLIGHT,
          color: match.highlight.color,
          opacity: match.highlight.opacity,
          thickness: 12,
          quadPoints: Float32Array.from(match.candidate.quadPoints),
          outlines,
          pageIndex: match.candidate.pageIndex,
          rect: match.candidate.rect,
          rotation: 0,
          id: null,
          deleted: false,
        });
      }

      const nextCandidateFingerprint = candidateFingerprint || pdfDocument.fingerprints?.[0] || "";
      return {
        pdfBytes: await pdfDocument.saveDocument(),
        snapshot: buildMigratedSnapshot(matches, nextCandidateFingerprint),
        candidateFingerprint: nextCandidateFingerprint,
      };
    } finally {
      await pdfDocument.destroy?.();
    }
  }

  async function syncAnnotatedPdf() {
    if (!canSyncCurrentDocument()) {
      showToast("La sincronizacion solo esta disponible para documentos guardados.", "info");
      return false;
    }
    if (!state.app?.pdfDocument) {
      showToast("Primero carga un PDF.", "info");
      return false;
    }
    if (state.isSyncing) {
      return false;
    }
    if (!hasUnsyncedAnnotations()) {
      showToast("No hay cambios pendientes para sincronizar.", "info");
      refreshSyncButtons();
      return false;
    }

    state.isSyncing = true;
    state.pendingExitSync = false;
    refreshSyncButtons();
    showStatus("Sincronizando...");

    try {
      const pdfBytes = await state.app.pdfDocument.saveDocument();
      const fileName = normalizePdfFileName(
        state.query.fileName || state.app._docFilename || (isCronogramaResource() ? "cronograma" : "material")
      );

      if (isLocalWorkspaceMode()) {
        await syncAnnotatedPdfToLocalWorkspace(pdfBytes, fileName);
        state.query.fileName = fileName;
        markDocumentAsSynced();
        refreshDocumentViewerMetadata();
        notifySubjectDayMaterialsRefresh();
        showStatus("Puedes salir, sincronizado.");
        scheduleHideStatus();
        return true;
      }

      const formData = new FormData();
      formData.set("file", new Blob([pdfBytes], { type: "application/pdf" }), fileName);
      formData.set("fileName", fileName);

      if (!isCronogramaResource()) {
        const highlightSnapshot = await buildHighlightSnapshot();
        formData.set("sourcePdfFingerprint", highlightSnapshot.sourcePdfFingerprint || "");
        formData.set("highlightSnapshot", JSON.stringify(highlightSnapshot.snapshot));
      }

      const payload = await requireOkJson(
        await fetch(getCurrentSyncUrl(), {
          method: "POST",
          body: formData,
        }),
        "No se pudo sincronizar el PDF anotado."
      );

      state.query.fileName =
        payload && typeof payload === "object" && typeof payload.file_name === "string" && payload.file_name.trim()
          ? payload.file_name.trim()
          : payload && typeof payload === "object" && typeof payload.fileName === "string" && payload.fileName.trim()
            ? payload.fileName.trim()
            : fileName;

      markDocumentAsSynced();
      refreshDocumentViewerMetadata();
      notifySubjectDayMaterialsRefresh();
      showStatus("Puedes salir, sincronizado.");
      scheduleHideStatus();
      return true;
    } catch (error) {
      console.error("Custom PDF.js sync failed:", error);
      showStatus("La sincronizacion fallo.");
      scheduleHideStatus(3200);
      showToast(error instanceof Error ? error.message : "No se pudo sincronizar el PDF anotado.", "error", 4200);
      return false;
    } finally {
      state.isSyncing = false;
      refreshSyncButtons();
    }
  }

  function openReplacementPicker() {
    if (!canReplaceMaterial()) {
      showToast("El reemplazo solo esta disponible para materiales guardados.", "info");
      return;
    }
    if (!state.app?.pdfDocument) {
      showToast("Primero carga un PDF.", "info");
      return;
    }
    if (state.isSyncing) {
      showToast("Espera a que termine la sincronizacion actual.", "info");
      return;
    }
    if (state.hasUnsyncedChanges) {
      showToast("Sincroniza los cambios antes de reemplazar el PDF.", "info", 3200);
      return;
    }

    ensureUi();
    state.replaceInput.click();
  }

  function closeReplacementModal() {
    if (state.replacementBackdrop) {
      state.replacementBackdrop.dataset.open = "false";
    }
    state.replacementPreview = null;
    state.replacementToken = "";
    state.replacementCandidateBytes = null;
    state.replacementDecisions = new Map();
  }

  function renderReplacementPreview(preview) {
    state.replacementPreview = preview;
    state.replacementDecisions = new Map(
      (preview.reviewMatches || []).map((match) => [match.highlight.annotationId, "skip"])
    );

    const baseDescription = `${preview.candidateFileName || "PDF nuevo"}: ${preview.summary.autoMatches} automaticos, ${preview.summary.reviewMatches} para revisar y ${preview.summary.unmatched} no migrables.`;
    const sourceDescription =
      preview?.migrationSource === "viewer"
        ? "Usando highlights del visor abierto."
        : preview?.migrationSource === "database"
          ? "Usando highlights guardados previamente."
          : preview?.migrationSource === "storage"
            ? "Usando highlights reconstruidos desde el PDF actual."
            : "";
    state.replacementDescription.textContent =
      [baseDescription, sourceDescription, "Los recortes guardados por tag se limpiarán porque sus coordenadas pertenecen al PDF anterior.", typeof preview?.migrationWarning === "string" ? preview.migrationWarning.trim() : ""]
        .filter(Boolean)
        .join(" ");
    state.replacementAutoCount.textContent = String(preview.summary.autoMatches || 0);
    state.replacementReviewCount.textContent = String(preview.summary.reviewMatches || 0);
    state.replacementUnmatchedCount.textContent = String(preview.summary.unmatched || 0);

    state.replacementReviewList.replaceChildren();
    const reviewMatches = preview.reviewMatches || [];
    if (!reviewMatches.length) {
      const empty = document.createElement("div");
      empty.className = "pdfjs-custom-replacement-empty";
      empty.textContent = "No hay coincidencias dudosas. Si continuas, solo se aplicaran las automaticas.";
      state.replacementReviewList.appendChild(empty);
    } else {
      reviewMatches.forEach((match) => {
        const card = document.createElement("article");
        card.className = "pdfjs-custom-replacement-card";

        const quote = document.createElement("p");
        quote.className = "pdfjs-custom-replacement-quote";
        quote.textContent = match.highlight.exactQuote || "Sin texto recuperable";
        card.appendChild(quote);

        const meta = document.createElement("p");
        meta.className = "pdfjs-custom-replacement-meta";
        meta.textContent = `Pagina original ${match.highlight.pageIndex + 1} -> candidata ${match.candidate.pageIndex + 1}. Score ${match.score}. ${match.reason}`;
        card.appendChild(meta);

        const actions = document.createElement("div");
        actions.className = "pdfjs-custom-replacement-actions";

        ["accept", "discard", "skip"].forEach((action) => {
          const button = document.createElement("button");
          button.type = "button";
          button.dataset.action = action;
          button.dataset.selected = action === "skip" ? "true" : "false";
          button.textContent =
            action === "accept" ? "Aceptar candidato" : action === "discard" ? "Descartar" : "Dejar sin migrar";
          button.addEventListener("click", () => {
            state.replacementDecisions.set(match.highlight.annotationId, action);
            actions.querySelectorAll("button").forEach((node) => {
              node.dataset.selected = node.dataset.action === action ? "true" : "false";
            });
          });
          actions.appendChild(button);
        });

        card.appendChild(actions);
        state.replacementReviewList.appendChild(card);
      });
    }

    state.replacementUnmatchedList.replaceChildren();
    const unmatched = preview.unmatched || [];
    if (!unmatched.length) {
      const empty = document.createElement("div");
      empty.className = "pdfjs-custom-replacement-empty";
      empty.textContent = "No hay highlights descartados automaticamente.";
      state.replacementUnmatchedList.appendChild(empty);
    } else {
      unmatched.forEach((item) => {
        const card = document.createElement("article");
        card.className = "pdfjs-custom-replacement-unmatched-item";

        const quote = document.createElement("p");
        quote.className = "pdfjs-custom-replacement-quote";
        quote.textContent = item.highlight.exactQuote || "Highlight sin texto recuperable";
        card.appendChild(quote);

        const meta = document.createElement("p");
        meta.className = "pdfjs-custom-replacement-meta";
        meta.textContent = item.reason;
        card.appendChild(meta);

        state.replacementUnmatchedList.appendChild(card);
      });
    }

    state.replacementBackdrop.dataset.open = "true";
  }

  async function previewReplacement(file) {
    showBusy("Analizando PDF nuevo...");
    closeReplacementModal();

    try {
      const fileName = normalizePdfFileName(file.name || state.query.fileName || "material");
      state.replacementCandidateBytes = new Uint8Array(await file.arrayBuffer());
      let sourceSnapshot = {
        sourcePdfFingerprint: "",
        snapshot: [],
      };

      try {
        updateBusy("Leyendo highlights del visor...");
        const nextSourceSnapshot = await buildSourceHighlightSnapshotForReplacement();
        sourceSnapshot = {
          sourcePdfFingerprint: nextSourceSnapshot.sourcePdfFingerprint || "",
          snapshot: Array.isArray(nextSourceSnapshot.snapshot) ? nextSourceSnapshot.snapshot : [],
        };
      } catch (error) {
        console.warn("Custom PDF.js could not build viewer replacement snapshot:", error);
      }

      const formData = new FormData();
      formData.set("file", file, fileName);
      formData.set("fileName", fileName);
      formData.set("sourcePdfFingerprint", sourceSnapshot.sourcePdfFingerprint || "");
      formData.set("sourceHighlightSnapshot", JSON.stringify(sourceSnapshot.snapshot));

      updateBusy("Subiendo PDF candidato...");
      const preview = await requireOkJson(
        await fetch(`/api/subject-day-materials/${state.query.materialId}/replace-preview`, {
          method: "POST",
          body: formData,
        }),
        "No se pudo preparar el reemplazo del PDF."
      );

      state.replacementToken =
        preview && typeof preview === "object" && typeof preview.replacementToken === "string"
          ? preview.replacementToken.trim()
          : "";
      if (!state.replacementToken) {
        throw new Error("El servidor no devolvio el token del reemplazo.");
      }

      renderReplacementPreview(preview);
    } catch (error) {
      console.error("Custom PDF.js replacement preview failed:", error);
      showToast(error instanceof Error ? error.message : "No se pudo analizar el PDF nuevo.", "error", 4200);
    } finally {
      hideBusy();
    }
  }

  async function commitReplacement() {
    if (!state.replacementPreview || !state.replacementToken) {
      showToast("Falta la vista previa del reemplazo.", "error", 3200);
      return;
    }

    showBusy("Aplicando reemplazo...");

    try {
      const decisions = Array.from(state.replacementDecisions.entries()).map(([annotationId, action]) => ({
        annotationId,
        action,
      }));

      updateBusy("Guardando PDF reemplazado...");
      const payload = await requireOkJson(
        await fetch(`/api/subject-day-materials/${state.query.materialId}/replace-commit`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            replacementToken: state.replacementToken,
            decisions,
          }),
        }),
        "No se pudo confirmar el reemplazo del PDF."
      );

      if (payload && typeof payload === "object" && payload.material?.file_name) {
        state.query.fileName = String(payload.material.file_name).trim() || state.query.fileName;
      } else if (payload && typeof payload === "object" && typeof payload.file_name === "string") {
        state.query.fileName = payload.file_name.trim() || state.query.fileName;
      }

      state.suppressUnloadSync = true;
      markDocumentAsSynced();
      refreshDocumentViewerMetadata();
      notifySubjectDayMaterialsRefresh();
      showStatus("PDF reemplazado.");
      scheduleHideStatus(2400);
      const replacementBytes = state.replacementCandidateBytes;
      if (!replacementBytes) {
        throw new Error("Faltan los bytes del PDF reemplazado para reabrirlo en caliente.");
      }
      await reopenDocumentInViewer(replacementBytes, state.query.fileName || "material.pdf");
    } catch (error) {
      console.error("Custom PDF.js replacement commit failed:", error);
      showToast(error instanceof Error ? error.message : "No se pudo reemplazar el PDF.", "error", 4200);
    } finally {
      hideBusy();
    }
  }

  function handleBeforeUnload(event) {
    if (state.suppressUnloadSync || !canSyncCurrentDocument() || state.isSyncing || !hasUnsyncedAnnotations()) {
      return;
    }

    state.pendingExitSync = true;
    refreshSyncButtons();
    showStatus("Sincronizando...");
    clearExitSyncTimer();
    state.exitSyncTimer = window.setTimeout(() => {
      state.exitSyncTimer = null;
      if (state.pendingExitSync && document.visibilityState === "visible" && !state.isSyncing) {
        void syncAnnotatedPdf();
      }
    }, 120);

    event.preventDefault();
    event.returnValue = "";
  }

  function handlePageHide() {
    state.pendingExitSync = false;
    clearExitSyncTimer();
    cleanupLocalWorkspaceObjectUrl();
  }

  function handleParentMessage(event) {
    if (event.origin !== window.location.origin || !event.data || typeof event.data.type !== "string") {
      return;
    }

    if (event.data.type === "viewerWorkspaceRootHandle" && event.data.handle) {
      state.workspaceRootHandle = event.data.handle;
      if (
        isLocalWorkspaceMode() &&
        state.query?.workspaceFileId &&
        !state.localWorkspaceObjectUrl &&
        !state.isOpeningLocalWorkspaceDocument
      ) {
        void openLocalWorkspaceDocumentInViewer().catch((error) => {
          console.error("Custom PDF.js local workspace retry failed:", error);
          showToast(error instanceof Error ? error.message : "No se pudo abrir el PDF local.", "error", 5000);
        });
      }
      return;
    }

    if (event.data.type === "viewerWorkspaceMode" && event.data.mode === "local") {
      state.workspaceMode = "local";
      refreshSyncButtons();
      return;
    }

    if (event.data.type === "viewerMaterialTagRegions") {
      if (isPresentationMode()) {
        const presentationTagId = Number(event.data.tagId);
        if (state.presentationPendingTagIds.has(presentationTagId)) {
          state.presentationRegionsByTag.set(
            presentationTagId,
            event.data.ok && Array.isArray(event.data.regions) ? event.data.regions : []
          );
          state.presentationPendingTagIds.delete(presentationTagId);
          if (state.presentationPendingTagIds.size === 0) {
            void openPresentationDocument();
          }
        }
        return;
      }
      if (!event.data.ok) {
        if (state.tagStatus) state.tagStatus.textContent = event.data.error || "No se pudieron cargar las regiones.";
        return;
      }
      const tagId = Number(event.data.tagId);
      const tag = state.tagCatalog.find((candidate) => candidate.id === tagId);
      state.activeRegionTagId = tagId;
      state.activeRegionTagName = tag?.name || "tag";
      state.selections = (Array.isArray(event.data.regions) ? event.data.regions : []).map((region, index) => ({
        id: `tag-${tagId}-${index}-${Date.now()}`,
        pageNum: Number(region.pageNumber),
        pageRotation: Number(region.pageRotation || 0),
        xp1: Number(region.x1),
        yp1: Number(region.y1),
        xp2: Number(region.x2),
        yp2: Number(region.y2),
      }));
      state.selectionMode = true;
      refreshLayers();
      renderMaterialTags();
      if (state.tagStatus) state.tagStatus.textContent = `Marca regiones y vuelve a pulsar #${state.activeRegionTagName} para guardar.`;
      showToast(`Captura activa para #${state.activeRegionTagName}.`, "info", 2600);
      return;
    }

    if (event.data.type === "viewerMaterialTagRegionsSaved") {
      if (!event.data.ok) {
        if (state.tagStatus) state.tagStatus.textContent = event.data.error || "No se pudieron guardar las regiones.";
        return;
      }
      const tagId = Number(event.data.tagId);
      state.tagRegionCounts[String(tagId)] = Array.isArray(event.data.regions) ? event.data.regions.length : state.selections.length;
      state.activeRegionTagId = null;
      state.activeRegionTagName = "";
      clearSelections();
      leaveSelectionMode();
      renderMaterialTags();
      if (state.tagStatus) state.tagStatus.textContent = "Regiones guardadas.";
      showToast("Regiones del tag guardadas.", "success", 2200);
      return;
    }

    if (event.data.type === "viewerMaterialTagResult") {
      if (!state.tagPanel) return;
      if (event.data.ok) {
        if (Array.isArray(event.data.tags)) {
          const catalogById = new Map(state.tagCatalog.map((tag) => [tag.id, tag]));
          for (const tag of event.data.tags) catalogById.set(tag.id, tag);
          state.tagCatalog = Array.from(catalogById.values());
          state.assignedTagIds = new Set(event.data.tags.map((tag) => tag.id));
          renderMaterialTags();
        }
        const tagNames = Array.isArray(event.data.tags)
          ? event.data.tags.map((tag) => `#${tag.name}`).join(", ")
          : "";
        if (state.tagStatus) state.tagStatus.textContent = tagNames ? `Asignado: ${tagNames}` : "Tag actualizado.";
        window.setTimeout(closeMaterialTagPanel, 900);
      } else if (state.tagStatus) {
        state.tagStatus.textContent = event.data.error || "No se pudo asignar el tag.";
      }
      return;
    }

    if (event.data.type === "viewerMaterialTags") {
      state.tagCatalog = Array.isArray(event.data.tags) ? event.data.tags : [];
      state.assignedTagIds = new Set(
        Array.isArray(event.data.assignedTagIds) ? event.data.assignedTagIds.map(Number).filter(Number.isInteger) : []
      );
      state.tagRegionCounts = event.data.regionCounts && typeof event.data.regionCounts === "object"
        ? event.data.regionCounts
        : {};
      renderMaterialTags();
      return;
    }

    if (event.data.type === "requestViewerEscape") {
      handleViewerEscape();
      return;
    }

    if (event.data.type === "practiceFragmentUploadState") {
      if (event.data.status === "uploading") {
        showBusy("Subiendo PDF fragmentado...");
        return;
      }
      hideBusy();
      if (event.data.status === "success") {
        showToast(`PDF creado: ${event.data.fileName || "fragmento.pdf"}`, "success", 3200);
        return;
      }
      if (event.data.status === "error") {
        showToast(event.data.error || "No se pudo subir el PDF fragmentado.", "error", 4200);
      }
    }
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

      if (isLocalWorkspaceMode()) {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage(
            {
              type: "uploadPracticeFragment",
              payload: {
                blob: pdfData.blob,
                fileName: pdfData.fileName,
              },
            },
            window.location.origin
          );
          clearSelections();
          leaveSelectionMode();
          showToast(`PDF enviado: ${pdfData.fileName}`, "success", 3200);
          return;
        }

        throw new Error("El modo local de fragmentos necesita abrirse desde la app principal.");
      }

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
            materialType: state.query.materialType || "practice",
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
            materialType: state.query.materialType || "practice",
            driveFileId: uploadResult.driveFileId,
            fileName: pdfData.fileName,
          }),
        }),
        "No se pudo confirmar el PDF fragmentado."
      );

      notifySubjectDayMaterialsRefresh();
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
    const presentationWasOpening =
      isPresentationMode() && state.presentationPhase === "opening";
    if (presentationWasOpening) {
      state.presentationPhase = "ready";
      document.documentElement.classList.remove("pdfjs-custom-presentation-preparing");
    }
    state.sourcePdfBytes = null;
    state.sourcePdfLibDoc = null;
    clearSelections();
    state.activeRegionTagId = null;
    state.activeRegionTagName = "";
    cancelCutSelection();
    clearPageTextModels();
    closeReplacementModal();
    leaveSelectionMode();
    updateDraftOverlay();
    applyEnhancedPdfReadability();
    refreshSyncButtons();
    refreshCutButton();
    if (!isPresentationMode() || presentationWasOpening) {
      hideLoadingOverlay();
    }
    postToParent({
      type: "viewerDocumentLoaded",
      materialId: state.query?.materialId,
      fileName: state.query?.fileName || state.app?._docFilename || "",
      fingerprint: state.app?.pdfDocument?.fingerprints?.[0] || "",
      numPages: state.app?.pdfDocument?.numPages || 0,
    });
    if (isPresentationMode() && state.presentationPhase === "source") {
      requestPresentationRegions();
    }
  }

  function initializePresentationScale() {
    if (
      !isPresentationMode() ||
      !["opening", "ready"].includes(state.presentationPhase) ||
      state.presentationScaleInitialized ||
      !state.app?.pdfViewer
    ) {
      return;
    }
    state.presentationScaleInitialized = true;
    state.app.pdfViewer.currentScaleValue = "1.5";
  }

  function handleKeyDown(event) {
    if (!state.app || event.defaultPrevented || event.repeat) return;
    if (isEditableTarget(event.target)) return;

    const key = event.key.toLowerCase();

    if (!event.ctrlKey && !event.altKey && !event.metaKey && key === "escape") {
      handleViewerEscape(event);
      return;
    }

    if (!event.ctrlKey && !event.altKey && !event.metaKey && key === "e") {
      state.enhancedPdfReadability = !state.enhancedPdfReadability;
      applyEnhancedPdfReadability();
      return;
    }

    if (event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && key === "i") {
      event.preventDefault();
      if (isPresentationMode()) {
        showToast("La presentacion solo admite herramientas nativas y descarga.", "info");
        return;
      }
      if (state.activeRegionTagId != null) {
        showToast("Guarda o cancela las regiones del tag activo.", "info");
        return;
      }
      toggleSelectionMode();
      return;
    }

    if (event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && key === "m") {
      event.preventDefault();
      if (isPresentationMode()) {
        showToast("La presentacion no se sube sobre el material original.", "info");
        return;
      }
      if (state.activeRegionTagId != null) {
        showToast("Guarda o cancela las regiones del tag activo.", "info");
        return;
      }
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
    state.presentationPhase = isPresentationMode() ? "source" : "idle";
    ensureUi();
    bindSyncButtons();
    refreshLayers();
    updateDraftOverlay();

    const { eventBus } = app;
    eventBus.on("pagerendered", () => {
      refreshLayers();
      applyEnhancedPdfReadability();
      refreshSyncButtons();
    });
    eventBus.on("pagechanging", refreshLayers);
    eventBus.on("pagesinit", initializePresentationScale);
    eventBus.on("scalechanging", refreshLayers);
    eventBus.on("rotationchanging", refreshLayers);
    eventBus.on("documentloaded", onDocumentLoaded);
    eventBus.on("documenterror", ({ message, reason } = {}) => {
      updateDraftOverlay();
      refreshSyncButtons();
      refreshCutButton();
      if (isPresentationMode()) {
        state.presentationPhase = "error";
        document.documentElement.classList.add("pdfjs-custom-presentation-preparing");
        showLoadingOverlay("No se pudo cargar la presentacion.");
      } else {
        hideLoadingOverlay();
        showToast(reason || message || "No se pudo abrir el PDF.", "error", 5000);
      }
      postToParent({
        type: "viewerDocumentError",
        materialId: state.query?.materialId,
        fileName: state.query?.fileName || "",
        error: reason || message || "No se pudo abrir el PDF.",
      });
    });
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("click", handleCutPageClick, true);
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("message", handleParentMessage);

    if (isLocalWorkspaceMode() && state.query?.workspaceFileId) {
      try {
        await openLocalWorkspaceDocumentInViewer();
      } catch (error) {
        console.error("Custom PDF.js local workspace open failed:", error);
        hideLoadingOverlay();
        showToast(error instanceof Error ? error.message : "No se pudo abrir el PDF local.", "error", 5000);
        postToParent({
          type: "viewerDocumentError",
          materialId: state.query?.materialId,
          fileName: state.query?.fileName || "",
          error: error instanceof Error ? error.message : "No se pudo abrir el PDF local.",
        });
      }
    }

    postToParent({ type: "viewerReady" });

    if (!state.syncStatePoller) {
      state.syncStatePoller = window.setInterval(refreshSyncButtons, 400);
    }

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
