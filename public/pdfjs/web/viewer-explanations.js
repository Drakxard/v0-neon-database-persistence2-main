/* Explanations use real PDF.js FreeText editors and a local HTML/position manifest. */
window.initPdfExplanations = function ({ app, query, ensureWorkspaceRootHandle, inscreenApiFetch, showToast }) {
  const toolbar = document.getElementById("toolbarViewerRight");
  if (!toolbar) return;
  let documentState = null, loading = null, modal = null, restoring = false;
  let saving = Promise.resolve();
  const editors = new Map();
  const star = document.createElement("button");
  star.id = "pdfExplanationButton";
  star.className = "toolbarButton pdf-explanation-star";
  star.type = "button";
  star.title = "Explicaciones";
  star.setAttribute("aria-label", "Explicaciones");
  star.setAttribute("aria-haspopup", "menu");
  star.setAttribute("aria-expanded", "false");
  toolbar.prepend(star);
  const menu = document.createElement("div");
  menu.className = "pdf-explanation-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  menu.innerHTML = '<button type="button" role="menuitem">Verlo</button><button type="button" role="menuitem" disabled title="Próximamente">Procedimiento</button>';
  document.body.append(menu);
  const report = error => showToast(error instanceof Error ? error.message : "No se pudo guardar la explicación.", "error", 6000);
  const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
  async function fileHandle(root, path, create = false) {
    const parts = path.split("/");
    let dir = root;
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create });
    return dir.getFileHandle(parts.at(-1), { create });
  }
  async function read(root, path) {
    try { return JSON.parse(await (await (await fileHandle(root, path)).getFile()).text()); }
    catch (error) { if (error.name === "NotFoundError") return null; throw error; }
  }
  async function write(root, path, text) {
    const writer = await (await fileHandle(root, path, true)).createWritable();
    try { await writer.write(text); await writer.close(); }
    catch (error) { await writer.abort().catch(() => {}); throw error; }
  }
  async function load() {
    if (!app.pdfDocument) throw new Error("Esperá a que termine de cargar el PDF.");
    if (documentState?.pdf === app.pdfDocument) return documentState;
    if (loading) return loading;
    const pdf = app.pdfDocument;
    loading = (async () => {
      const bytes = await pdf.getData();
      const sourceHash = await hash(bytes);
      const identity = query.workspaceFileId || query.key || `${query.resourceType}:${query.materialId || sourceHash}`;
      const key = await hash(new TextEncoder().encode(identity));
      const root = query.localWorkspace ? await ensureWorkspaceRootHandle() : null;
      const path = `manifests/pdf-explanations/${key}/explanations.json`;
      const saved = root ? await read(root, path) : JSON.parse(localStorage.getItem(`pdf-explanations:${key}`) || "null");
      if (saved && (saved.version !== 1 || !Array.isArray(saved.entries) || !saved.transcriptions)) {
        throw new Error("El archivo de explicaciones guardadas no es válido.");
      }
      if (app.pdfDocument !== pdf) throw new Error("El PDF cambió. Volvé a abrir la explicación.");
      editors.clear();
      let fingerprint = pdf.fingerprints[0];
      const data = saved || { version: 1, entries: [], transcriptions: {} };
      // Some PDFs have no document ID until PDF.js saves the first annotation, so their
      // fingerprint changes on that save. A persisted note links that revision to its source.
      if (saved && data.fingerprint !== fingerprint) {
        for (const entry of data.entries) {
          const page = entry.annotation?.pageIndex + 1;
          if (!(page > 0 && page <= pdf.numPages)) continue;
          const annotations = await (await pdf.getPage(page)).getAnnotations();
          if (annotations.some(a => a.subtype === "FreeText" && (a.textContent?.join("\n") || "").trim() === entry.annotation.value.trim())) {
            fingerprint = data.fingerprint;
            break;
          }
        }
      }
      const extractionHash = data.fingerprint === fingerprint ? data.extractionHash || sourceHash : sourceHash;
      data.fingerprint = fingerprint;
      data.extractionHash = extractionHash;
      documentState = { pdf, bytes, sourceHash: extractionHash, fingerprint, key, root, path, data };
      return documentState;
    })();
    try { return await loading; } finally { loading = null; }
  }
  function persist(state) {
    const json = JSON.stringify(state.data);
    const next = saving.catch(() => {}).then(async () => {
      if (!state.root) { localStorage.setItem(`pdf-explanations:${state.key}`, json); return; }
      const previous = await read(state.root, state.path);
      if (previous) await write(state.root, state.path + ".backup", JSON.stringify(previous));
      await write(state.root, state.path, json);
    });
    saving = next;
    return next;
  }
  async function transcription(state, page) {
    const key = `${state.fingerprint}:${page}`;
    if (state.data.transcriptions[key]) return state.data.transcriptions[key];
    // Conjuntos stores Datalab blocks with original (one-based) page numbers.
    if (state.root) {
      const extraction = await read(state.root, `manifests/subject-voice/pdf/datalab-balanced-json-v1/${state.sourceHash}/extraction.json`);
      const blocks = (extraction?.batches || []).flatMap(batch => {
        if (batch.extraction?.failedPages?.includes(page)) return [];
        return (batch.extraction?.blocks || []).filter(block => block.page === page && typeof block.text === "string");
      });
      const text = blocks.map(block => block.text).join("\n\n").trim();
      if (text) {
        state.data.transcriptions[key] = text;
        await persist(state);
        return text;
      }
    }
    const source = await window.PDFLib.PDFDocument.load(state.bytes);
    const single = await window.PDFLib.PDFDocument.create();
    const [copied] = await single.copyPages(source, [page - 1]);
    single.addPage(copied);
    const form = new FormData();
    form.set("file", new File([await single.save()], `pagina-${page}.pdf`, { type: "application/pdf" }));
    const init = { method: "POST", body: form, signal: AbortSignal.timeout(65_000) };
    let response;
    try { response = await inscreenApiFetch("/api/inscreen/marker-transcribe", init); }
    catch (error) {
      if (error.name !== "InscreenConfigurationUnavailable") throw error;
      response = await fetch("/api/inscreen/marker-transcribe", init);
    }
    const payload = await response.json();
    if (!response.ok || !payload.markdown?.trim()) throw new Error(payload.error || "Datalab devolvió una página vacía.");
    state.data.transcriptions[key] = payload.markdown;
    await persist(state); // Keep the transcription even if generation fails.
    return payload.markdown;
  }
  function close() {
    if (!modal) return;
    const previousFocus = modal.previousFocus;
    modal.node.remove();
    modal = null;
    previousFocus?.focus();
  }
  function overlay(title) {
    close();
    menu.hidden = true;
    star.setAttribute("aria-expanded", "false");
    const previousFocus = document.activeElement;
    const node = document.createElement("div");
    node.className = "pdf-explanation-overlay";
    node.setAttribute("role", "dialog");
    node.setAttribute("aria-modal", "true");
    node.setAttribute("aria-label", title);
    const panel = document.createElement("section");
    panel.className = "pdf-explanation-panel";
    const header = document.createElement("header");
    const heading = document.createElement("strong");
    heading.textContent = title;
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.textContent = "Cerrar · Esc";
    dismiss.addEventListener("click", close);
    header.append(heading, dismiss);
    panel.append(header);
    node.append(panel);
    document.body.append(node);
    modal = { node, panel, previousFocus };
    dismiss.focus();
    return modal;
  }
  function openHtml(entry) {
    const view = overlay(entry.question);
    view.panel.classList.add("pdf-explanation-result");
    const iframe = document.createElement("iframe");
    iframe.title = entry.question;
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("referrerpolicy", "no-referrer");
    // CSP is inserted before all generated content, including malformed/missing <head>.
    const csp = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: blob:; font-src data:; connect-src \'none\'; form-action \'none\'; base-uri \'none\'">';
    const escapeBridge = `<script>addEventListener('keydown',e=>{if(e.key==='Escape')parent.postMessage({type:'pdf-explanation-escape'},'*')});<\/script>`;
    iframe.srcdoc = csp + escapeBridge + entry.html;
    view.panel.append(iframe);
    iframe.focus();
  }
  function bindEditor(entry, editor) {
    editors.set(entry.id, editor);
    const div = editor.div;
    if (!div || div.dataset.explanationId) return;
    div.dataset.explanationId = entry.id;
    div.classList.add("pdf-explanation-text");
    div.title = "Clic para ver la explicación; arrastrá para ubicarla";
    let drag = null;
    div.addEventListener("pointerdown", event => {
      if (event.button !== 0 || event.target.closest(".editToolbar, .resizers")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, startX: editor.x, startY: editor.y, moved: false };
      div.setPointerCapture(event.pointerId);
    }, true);
    div.addEventListener("pointermove", event => {
      if (!drag || drag.pointer !== event.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (Math.hypot(dx, dy) > 5) drag.moved = true;
      if (!drag.moved) return;
      const [tx, ty] = editor.screenToPageTranslation(dx, dy);
      const [width, height] = editor.parentDimensions;
      editor.x = drag.startX + tx / width;
      editor.y = drag.startY + ty / height;
      editor.fixAndSetPosition();
    });
    const finish = event => {
      if (!drag || drag.pointer !== event.pointerId) return;
      const moved = drag.moved;
      drag = null;
      if (div.hasPointerCapture(event.pointerId)) div.releasePointerCapture(event.pointerId);
      if (moved) {
        editor.commit();
        entry.annotation = editor.serialize() || entry.annotation;
        entry.position = { x: editor.x, y: editor.y };
        persist(documentState).catch(report);
      } else if (event.type !== "pointercancel") openHtml(entry);
    };
    div.addEventListener("pointerup", finish);
    div.addEventListener("pointercancel", finish);
    div.addEventListener("click", event => { event.preventDefault(); event.stopImmediatePropagation(); }, true);
    div.addEventListener("dblclick", event => { event.preventDefault(); event.stopImmediatePropagation(); }, true);
    div.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopImmediatePropagation(); openHtml(entry); }
    }, true);
  }
  async function restore() {
    if (!documentState || restoring || documentState.pdf !== app.pdfDocument) return;
    restoring = true;
    try {
      const usedAnnotations = new Set([...editors.values()].map(editor => editor.annotationElementId).filter(Boolean));
      for (const entry of documentState.data.entries) {
        const layer = app.pdfViewer.getPageView(entry.annotation.pageIndex)?.annotationEditorLayer?.annotationEditorLayer;
        if (!layer) continue;
        const bound = editors.get(entry.id);
        if (bound) {
          if (bound.parent !== layer || !bound.isAttachedToDOM) layer.addOrRebuild(bound);
          layer.div.hidden = false;
          bound.show();
          if (bound.annotationElementId) layer.getEditableAnnotation(bound.annotationElementId)?.hide();
          continue;
        }
        // PDF autosave may already contain the note: bind that annotation rather than duplicating it.
        const annotations = await (await app.pdfDocument.getPage(entry.annotation.pageIndex + 1)).getAnnotations();
        const existing = annotations.find(a => !usedAnnotations.has(a.id) && a.subtype === "FreeText" && (a.textContent?.join("\n") || a.contentsObj?.str || "").trim() === entry.annotation.value.trim());
        const native = existing && layer.getEditableAnnotation(existing.id);
        const editor = await layer.deserialize(native || { ...entry.annotation, isCopy: true });
        if (!editor) continue;
        const position = entry.position || { x: editor.x, y: editor.y };
        layer.addOrRebuild(editor);
        editor.x = position.x;
        editor.y = position.y;
        editor.fixAndSetPosition();
        native?.hide();
        if (native) usedAnnotations.add(existing.id);
        layer.div.hidden = false;
        bindEditor(entry, editor);
      }
    } catch (error) { report(error); } finally { restoring = false; }
  }
  async function ask() {
    menu.hidden = true;
    star.setAttribute("aria-expanded", "false");
    const page = app.pdfViewer.currentPageNumber;
    const view = overlay(`Verlo · página ${page}`);
    const form = document.createElement("form");
    form.innerHTML = '<label for="pdf-explanation-question">¿Qué pregunta o duda puntual querés entender?</label><textarea id="pdf-explanation-question" required maxlength="2000" rows="4" placeholder="Escribí tu duda sobre esta página"></textarea><p role="status" aria-live="polite"></p><button type="submit">Generar explicación</button>';
    view.panel.append(form);
    const input = form.querySelector("textarea"), status = form.querySelector("p"), submit = form.querySelector("button");
    input.focus();
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const question = input.value.trim();
      if (!question || submit.disabled) return;
      submit.disabled = true;
      input.disabled = true;
      try {
        const state = await load();
        status.textContent = "Preparando la transcripción de la página…";
        const text = await transcription(state, page);
        status.textContent = "Generando la explicación visual…";
        const html = await window.requestPdfExplanation(question, text, message => { status.textContent = message; });
        const pdfPage = await state.pdf.getPage(page);
        const [x1, y1, x2, y2] = pdfPage.view;
        const annotation = { annotationType: 3, pageIndex: page - 1, rect: [x1 + 24, y2 - 80, Math.min(x2 - 24, x1 + 320), y2 - 40], rotation: 0, color: [126, 70, 190], fontSize: 12, value: `★ ${question}` };
        const entry = { id: crypto.randomUUID(), question, html, annotation };
        if (state.root) await write(state.root, `manifests/pdf-explanations/${state.key}/${entry.id}.html`, entry.html);
        state.data.entries.push(entry);
        await persist(state);
        await restore();
        if (modal === view) openHtml(entry);
        else showToast("Explicación guardada. Tocá la duda en el PDF para abrirla.", "success", 5000);
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : "No se pudo generar la explicación.";
        if (modal !== view) report(error);
      } finally { submit.disabled = false; input.disabled = false; }
    });
  }
  star.addEventListener("click", () => {
    menu.hidden = !menu.hidden;
    star.setAttribute("aria-expanded", String(!menu.hidden));
    const rect = star.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.right = `${Math.max(8, innerWidth - rect.right)}px`;
    if (!menu.hidden) menu.querySelector("button").focus();
  });
  menu.querySelector("button").addEventListener("click", ask);
  document.addEventListener("pointerdown", event => {
    if (!menu.contains(event.target) && !star.contains(event.target)) { menu.hidden = true; star.setAttribute("aria-expanded", "false"); }
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && (modal || !menu.hidden)) {
      event.preventDefault(); event.stopImmediatePropagation(); close(); menu.hidden = true; star.setAttribute("aria-expanded", "false");
    }
    if (event.key === "Tab" && modal) {
      const items = [...modal.node.querySelectorAll("button:not(:disabled),textarea:not(:disabled),iframe")];
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }, true);
  window.addEventListener("message", event => {
    if (event.data?.type === "pdf-explanation-escape" && event.source === modal?.node.querySelector("iframe")?.contentWindow) close();
  });
  app.eventBus.on("documentloaded", () => { load().then(restore).catch(report); });
  app.eventBus.on("pagerendered", restore);
  app.eventBus.on("annotationeditorlayerrendered", restore);
  app.eventBus.on("annotationeditormodechanged", restore);
  if (app.pdfDocument) load().then(restore).catch(report);
};
