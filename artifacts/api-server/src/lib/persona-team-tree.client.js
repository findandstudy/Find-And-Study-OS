// Only the mock workspace panel loads this module. Server validation remains authoritative.
export function orderedTeam(input) {
  const draft = structuredClone(input);
  if (
    !Array.isArray(draft.members) ||
    draft.members.length < 1 ||
    draft.members.length > 20
  )
    throw Error("Takım 1–20 üye içermeli.");
  const map = new Map(draft.members.map((m) => [m.key, m]));
  if (map.size !== draft.members.length)
    throw Error("Aynı üye iki kez kullanılamaz.");
  const roots = draft.members.filter((m) => m.parent === null);
  if (roots.length !== 1 || roots[0].kind !== "manager")
    throw Error("Tek bir genel müdür olmalı.");
  for (const m of draft.members)
    if (
      m.parent !== null &&
      (!map.has(m.parent) ||
        map.get(m.parent).kind === "specialist" ||
        m.kind === "manager")
    )
      throw Error("Bu yönetici ilişkisi uygun değil.");
  const seen = new Set(),
    ordered = [];
  function visit(key) {
    if (seen.has(key)) throw Error("Döngü kurulamaz.");
    seen.add(key);
    ordered.push(map.get(key));
    for (const m of draft.members.filter((m) => m.parent === key)) visit(m.key);
  }
  visit(roots[0].key);
  if (ordered.length !== draft.members.length)
    throw Error("Döngü veya kopuk ilişki kurulamaz.");
  draft.members = ordered;
  return draft;
}
export function moveTeamMember(input, key, parent) {
  const draft = structuredClone(input),
    member = draft.members.find((m) => m.key === key);
  if (!member || member.kind === "manager" || key === parent)
    throw Error("Genel müdür taşınamaz; üye kendisine bağlanamaz.");
  member.parent = parent;
  return orderedTeam(draft);
}
export function removeTeamMember(input, key) {
  const draft = orderedTeam(input),
    member = draft.members.find((m) => m.key === key);
  if (!member || member.parent === null) throw Error("Genel müdür silinemez.");
  draft.members = draft.members
    .filter((m) => m.key !== key)
    .map((m) => (m.parent === key ? { ...m, parent: member.parent } : m));
  return orderedTeam(draft);
}
export function describeTeamChanges(before, after) {
  const old = new Map(orderedTeam(before).members.map((m) => [m.key, m]));
  const next = orderedTeam(after),
    changes = [];
  if (before.name !== after.name)
    changes.push("Takım adı değişti: " + after.name);
  for (const m of next.members) {
    const previous = old.get(m.key);
    if (!previous) changes.push("Eklendi: " + m.name);
    else {
      const labels = {
        name: "ad",
        parent: "bağlı birim",
        purpose: "talimat",
        output: "beklenen çıktı",
        capMicros: "bütçe",
        timeoutSeconds: "süre",
      };
      const fields = Object.entries(labels)
        .filter(([key]) => previous[key] !== m[key])
        .map(([, label]) => label);
      if (fields.length)
        changes.push(m.name + ": " + fields.join(", ") + " değişti.");
      old.delete(m.key);
    }
  }
  for (const m of old.values()) changes.push("Taslaktan çıkarıldı: " + m.name);
  return changes;
}
if (
  typeof document !== "undefined" &&
  document.body.dataset.personaMode !== "design-preview"
)
  initializePersonaTeamEditor();
export function initializePersonaTeamEditor({ designPreviewTemplate } = {}) {
  const designPreview = designPreviewTemplate !== undefined;
  const panelBase = document.body.dataset.panelBase || "";
  const staging = document.body.dataset.personaMode === "staging-mock";
  const main = document.querySelector("main"),
    operations = document.createElement("div");
  operations.id = "operations-panel";
  operations.setAttribute("role", "tabpanel");
  operations.setAttribute("aria-labelledby", "operations-tab");
  while (main.firstChild) operations.append(main.firstChild);
  const nav = document.createElement("div");
  nav.className = "org-tabs";
  nav.setAttribute("role", "tablist");
  nav.setAttribute("aria-label", "Ajan yönetimi görünümü");
  const panel = document.createElement("div");
  panel.id = "organization-panel";
  panel.hidden = true;
  panel.setAttribute("role", "tabpanel");
  panel.setAttribute("aria-labelledby", "organization-tab");
  function make(tag, id, text, parent = panel) {
    const n = document.createElement(tag);
    if (id) n.id = id;
    if (text) n.textContent = text;
    parent.append(n);
    return n;
  }
  const normal = make("button", "operations-tab", "Teknik test kayıtları", nav),
    treeTab = make("button", "organization-tab", "Organizasyon ağacı", nav);
  const tasksTab = make(
      "button",
      "team-tasks-tab",
      "Görevler ve sonuçlar",
      nav,
    ),
    tasksPanel = make("div", "team-tasks-panel", "", main);
  tasksPanel.hidden = true;
  tasksPanel.setAttribute("role", "tabpanel");
  tasksPanel.setAttribute("aria-labelledby", "team-tasks-tab");
  for (const [tab, target] of [
    [normal, operations],
    [treeTab, panel],
    [tasksTab, tasksPanel],
  ]) {
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", target.id);
  }
  main.append(nav, panel, tasksPanel, operations);
  let tasksView = null;
  if (!designPreview)
    import("./team-tasks.js")
      .then(({ initializeTeamTasks }) => {
        tasksView = initializeTeamTasks({
          container: tasksPanel,
          api: window.api,
        });
      })
      .catch(() =>
        make(
          "p",
          "",
          "Görev görünümü yüklenemedi. Açık taslağınızı koruyarak bağlantıyı kontrol edin.",
          tasksPanel,
        ),
      );
  make(
    "h1",
    "",
    designPreview ? "Takım tasarım önizlemesi" : "Takımını görerek yönet",
  );
  make(
    "p",
    "",
    designPreview
      ? "Yalnız tasarım önizlemesi. Kartları taşıyabilir, birim ve uzman ekleyebilir, bağlantı ve talimatları deneyebilirsiniz. Değişiklikler yalnız bu sekmenin belleğindedir; sayfayı yenileyince veya kapatınca kaybolur. Kalıcı kayıt, insan onayı, görev çalıştırma ve sağlayıcı bağlantısı yoktur. Gerçek kişisel veri girmeyin."
      : "Kartı taşı; boş alanı tutup haritayı kaydır. Bağla düğmesiyle yönetici seç. Taslak ve yerleşim proje ve oturum sahibine bağlı kaydedilir; çalıştırma ve yetki onayı değildir. " +
          (staging
            ? "Staging denemesi — gerçek sağlayıcılar kapalı."
            : "Yalnız yerel deneme — gerçek sağlayıcılar kapalı."),
  );
  const notice = make("p", "org-notice", "");
  notice.setAttribute("role", "status");
  notice.setAttribute("aria-live", "polite");
  const workspaceBar = make("div", "", "");
  workspaceBar.className = "org-toolbar";
  const workspaceStatus = make(
      "p",
      "org-workspace-status",
      "Çalışma alanı henüz yüklenmedi.",
      workspaceBar,
    ),
    workspaceSave = make(
      "button",
      "org-workspace-save",
      "Taslağı şimdi kaydet",
      workspaceBar,
    ),
    workspaceLoad = make(
      "button",
      "org-workspace-load",
      "Sunucudaki taslağı yükle",
      workspaceBar,
    );
  workspaceStatus.setAttribute("role", "status");
  const exportDraft = make(
    "button",
    "org-export",
    "Taslak yedeğini indir",
    workspaceBar,
  );
  const importLabel = make(
    "label",
    "",
    "Taslak yedeğini geri yükle",
    workspaceBar,
  );
  importLabel.htmlFor = "org-import";
  const importDraft = make("input", "org-import", "", workspaceBar);
  importDraft.type = "file";
  importDraft.accept = ".json,application/json";
  make(
    "p",
    "",
    staging
      ? "Taslak ve yerleşim staging ortamında kalıcı saklanır; bu ekran 30 dakika sonunda temizlenmez. Gerçek kişisel veri girmeyin. İndirilen yedek onay, yetki veya çalıştırma bilgisi içermez."
      : "Bu önizlemenin test veritabanı süre sonunda temizlenir. Deneme dışında saklamak için taslak yedeğini indirin; yedek onay, yetki veya çalıştırma bilgisi içermez.",
    workspaceBar,
  );
  const changeBox = make("details", "org-changes", "");
  make("summary", "", "Bu düzenlemede neler değişti?", changeBox);
  const changesList = make("ul", "org-change-list", "", changeBox);
  const library = make("details", "org-library", "");
  make("summary", "", "Şablon ve kayıtlı taslaklar", library);
  const toolbar = make("div", "", "", library);
  toolbar.className = "org-toolbar";
  const template = make(
      "button",
      "org-template",
      "Yeni sosyal medya şablonu",
      toolbar,
    ),
    load = make("button", "org-load", "Kayıtlı taslakları yükle", toolbar);
  function field(tag, id, label, parent = panel) {
    const l = make("label", "", label, parent);
    l.htmlFor = id;
    return make(tag, id, "", parent);
  }
  const saved = field("select", "org-saved", "Kayıtlı takım taslağı", toolbar),
    open = make("button", "org-open", "Seçili taslağı düzenle", toolbar),
    owner = field("select", "org-owner", "Taslak kayıt sorumlusu", toolbar),
    title = field("input", "org-title", "Takım adı");
  title.maxLength = 100;
  const actions = make("div", "", "");
  const newParent = field(
    "select",
    "org-new-parent",
    "Yeni üye hangi yönetici veya birime bağlansın?",
  );
  panel.insertBefore(newParent.previousElementSibling, actions);
  panel.insertBefore(newParent, actions);
  actions.className = "org-toolbar";
  const department = make("button", "org-add-department", "+ Birim", actions),
    specialist = make("button", "org-add-specialist", "+ Uzman", actions),
    undo = make("button", "org-undo", "Son değişikliği geri al", actions),
    redo = make("button", "org-redo", "Yeniden yap", actions),
    save = make("button", "org-save", "Yeni sürümü onaya gönder", actions);
  const arrange = make("button", "org-arrange", "Otomatik yerleştir", actions);
  const layout = make("div", "", "");
  layout.className = "org-layout";
  const board = make("div", "", "", layout);
  board.className = "org-board";
  const search = field(
    "input",
    "org-search",
    "Takımda kişi veya birim ara",
    board,
  );
  search.type = "search";
  search.maxLength = 100;
  const searchResults = make("div", "org-search-results", "", board);
  searchResults.setAttribute("aria-label", "Arama sonuçları");
  const zoomBar = make("div", "", "", board);
  zoomBar.className = "org-zoom";
  zoomBar.setAttribute("role", "group");
  zoomBar.setAttribute("aria-label", "Çalışma alanı yakınlaştırma");
  const zoomOut = make("button", "org-zoom-out", "−", zoomBar),
    zoomLabel = make("output", "org-zoom-label", "100%", zoomBar),
    zoomIn = make("button", "org-zoom-in", "+", zoomBar),
    zoomReset = make("button", "org-zoom-reset", "100%", zoomBar),
    zoomFit = make("button", "org-zoom-fit", "Ekrana sığdır", zoomBar);
  zoomOut.setAttribute("aria-label", "Uzaklaştır");
  zoomIn.setAttribute("aria-label", "Yakınlaştır");
  zoomReset.setAttribute("aria-label", "Yakınlaştırmayı sıfırla");
  zoomLabel.setAttribute("aria-live", "polite");
  let zoom = 1,
    worldWidth = 960,
    worldHeight = 650;
  const canvas = make("div", "org-canvas", "", board);
  canvas.className = "org-canvas";
  canvas.setAttribute("aria-label", "Takım hiyerarşisi");
  canvas.tabIndex = 0;
  const editor = make("aside", "org-editor", "", layout);
  editor.setAttribute("aria-label", "Seçili üyenin yönetimi");
  const heading = make("h2", "org-member-title", "Kart seçin", editor),
    name = field("input", "org-name", "Ad", editor),
    parent = field("select", "org-parent", "Bağlı olduğu birim", editor),
    purpose = field("textarea", "org-purpose", "Görev ve talimatlar", editor),
    output = field("textarea", "org-output", "Beklenen çıktı", editor),
    budget = field(
      "input",
      "org-budget",
      "Sahte bütçe üst sınırı (mikro birim)",
      editor,
    ),
    timeout = field("input", "org-timeout", "Süre sınırı (saniye)", editor);
  name.maxLength = 100;
  purpose.maxLength = 2000;
  output.maxLength = 2000;
  purpose.rows = 6;
  output.rows = 3;
  budget.type = timeout.type = "number";
  budget.min = timeout.min = "1";
  budget.max = "1000000";
  timeout.max = "30";
  make(
    "p",
    "",
    designPreview
      ? "Bunlar yalnız tasarım alanlarıdır; talimatlar çalıştırılmaz. Bağlantılar ve bütçe/süre değerleri yetki veya işlem oluşturmaz."
      : "Mock sağlayıcı · yalnız taslak aracı · insan onayı zorunlu. Taşıma işlemi yeni erişim yetkisi vermez.",
    editor,
  );
  const apply = make(
    "button",
    "org-apply",
    "Kart değişikliklerini uygula",
    editor,
  );
  const connectApply = make(
    "button",
    "org-connect-apply",
    "Seçilen yöneticiye bağla",
    editor,
  );
  const remove = make("button", "org-remove", "Seçili üyeyi sil", editor);
  const discard = make(
    "button",
    "org-discard",
    "Kart değişikliğinden vazgeç",
    editor,
  );
  const memberTasks = make(
    "button",
    "org-member-tasks",
    "Bu üyenin görevlerine geç",
    editor,
  );
  const deleteBox = make("div", "org-delete-confirm", "", editor);
  deleteBox.hidden = true;
  deleteBox.setAttribute("role", "group");
  deleteBox.setAttribute("aria-label", "Silme etkisini inceleyin");
  const deleteText = make("p", "org-delete-impact", "", deleteBox),
    deleteYes = make(
      "button",
      "org-delete-yes",
      "Evet, taslaktan çıkar",
      deleteBox,
    ),
    deleteNo = make("button", "org-delete-no", "Vazgeç", deleteBox);
  const editorNotice = make("p", "org-editor-notice", "", editor);
  editorNotice.setAttribute("role", "status");
  let draft = null,
    selected = null,
    dirty = false,
    formDirty = false,
    history = [],
    future = [],
    rows = [],
    saving = false;
  let positions = new Map(),
    layoutKey = "template",
    connectKey = null;
  let baseline = null,
    collapsed = new Set();
  let workspaceRevision = 0,
    workspaceReady = false,
    workspaceBusy = false,
    workspaceConflict = false,
    workspacePending = false,
    workspaceTimer = null,
    workspaceLoading = false,
    pendingDelete = null;
  const layoutStorageKey = () =>
    "persona-tree-layout:" + document.body.dataset.project + ":" + layoutKey;
  function persistLayout() {
    if (designPreview) return;
    try {
      sessionStorage.setItem(
        layoutStorageKey(),
        JSON.stringify([...positions]),
      );
    } catch {
      say("Yerleşim bu açık ekranda korundu; tarayıcı saklamaya izin vermedi.");
    }
    scheduleWorkspaceSave();
  }
  function scheduleWorkspaceSave() {
    if (designPreview) return;
    workspacePending = true;
    clearTimeout(workspaceTimer);
    if (!workspaceReady || workspaceConflict) return;
    workspaceStatus.textContent = "Değişiklikler kaydedilmeyi bekliyor…";
    workspaceTimer = setTimeout(() => saveWorkspace(), 900);
  }
  async function saveWorkspace() {
    if (designPreview) return;
    clearTimeout(workspaceTimer);
    if (
      !workspaceReady ||
      workspaceBusy ||
      workspaceLoading ||
      saving ||
      workspaceConflict ||
      !draft
    )
      return;
    workspaceBusy = true;
    workspaceSave.disabled = true;
    let sent = false,
      completed = false;
    try {
      const document = formDirty ? editorDraft() : orderedTeam(draft);
      if (!title.value.trim()) throw Error("Takım adı boş olamaz.");
      document.name = title.value.trim();
      const layout = {
        positions: [...positions].map(([key, p]) => ({ key, ...p })),
        zoom,
        selectedKey: selected,
      };
      workspacePending = false;
      workspaceStatus.textContent = "Taslak ve yerleşim kaydediliyor…";
      sent = true;
      const result = await window.api(
        "/team-workspace",
        { expectedRevision: workspaceRevision, document, layout },
        "PUT",
      );
      workspaceRevision = result.workspace.revision;
      completed = true;
      workspaceStatus.textContent =
        "Taslak ve yerleşim kaydedildi · sürüm " +
        workspaceRevision +
        ". Onay veya çalıştırma yapılmadı.";
    } catch (e) {
      workspacePending = true;
      workspaceConflict = sent; // Do not blindly retry ambiguous writes, auth failures or stale revisions.
      workspaceStatus.textContent = !sent
        ? "Kaydedilmedi: " +
          e.message +
          " Alanları düzelttiğinizde kayıt devam eder."
        : e.message.includes("CONFLICT")
          ? "Başka sekmede daha yeni bir kayıt var. Üzerine yazılmadı. Sunucudaki taslağı yükleyip değişiklikleri karşılaştırın."
          : "Otomatik kayıt durdu: " +
            e.message +
            " Açık değişiklikler korunuyor. Bağlantıyı kontrol edip sunucudaki taslağı yükleyin.";
    } finally {
      workspaceBusy = false;
      workspaceSave.disabled = false;
      if (completed && workspacePending && !workspaceConflict)
        scheduleWorkspaceSave();
    }
  }
  async function loadWorkspace(ask = true) {
    if (designPreview) return loadTemplate();
    if (workspaceBusy || workspaceLoading || saving || pointer) return;
    if (
      ask &&
      (dirty || formDirty || workspacePending) &&
      !window.confirm(
        "Açık düzenlemeyi sunucudaki son kayıtla değiştirmek istiyor musunuz?",
      )
    )
      return;
    clearTimeout(workspaceTimer);
    workspaceLoading = true;
    controls();
    try {
      const { workspace } = await window.api("/team-workspace");
      workspaceRevision = workspace?.revision || 0;
      if (workspace) {
        draft = orderedTeam(workspace.document);
        baseline = structuredClone(draft);
        positions = new Map(
          workspace.layout.positions.map(({ key, x, y }) => [key, { x, y }]),
        );
        selected = workspace.layout.selectedKey || draft.members[0].key;
        zoom = workspace.layout.zoom;
        history = [];
        future = [];
        collapsed.clear();
        dirty = true;
        formDirty = false;
        connectKey = null;
        render();
        setZoom(zoom);
      }
      workspaceReady = true;
      workspaceConflict = false;
      workspacePending = false;
      workspaceStatus.textContent = workspace
        ? "Kaydedilmiş çalışma alanı geri yüklendi · sürüm " +
          workspaceRevision +
          ". Bu bir taslaktır, kurulu takım değildir."
        : "Yeni çalışma alanı hazır. Değişiklikler otomatik kaydedilecek.";
      if (!draft) await loadTemplate();
      return true;
    } catch (e) {
      workspaceStatus.textContent =
        "Çalışma alanı yüklenemedi: " +
        e.message +
        ". Üzerine yazmayı önlemek için otomatik kayıt kapalı.";
      workspaceReady = false;
      if (!draft) await loadTemplate();
      return false;
    } finally {
      workspaceLoading = false;
      controls();
    }
  }
  workspaceLoad.onclick = () => loadWorkspace();
  workspaceSave.onclick = () => {
    if (workspaceConflict || !workspaceReady) {
      workspaceStatus.textContent =
        "Önce sunucudaki taslağı yükleyin; belirsiz veya eski kayıt otomatik yeniden gönderilmez.";
      return;
    }
    saveWorkspace();
  };
  exportDraft.onclick = () => {
    if (designPreview) return;
    try {
      checkForm();
      const body = JSON.stringify(
        {
          schemaVersion: 1,
          projectId: document.body.dataset.project,
          document: orderedTeam(draft),
          layout: {
            positions: [...positions].map(([key, p]) => ({ key, ...p })),
            zoom,
            selectedKey: selected,
          },
        },
        null,
        2,
      );
      const blob = new Blob([body], { type: "application/json" });
      const url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = "find-study-takim-taslagi.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      say(
        "Düzenleme taslağı yedeklendi. Onay, oturum, yetki ve çalışma geçmişi dosyaya dahil edilmedi.",
      );
    } catch (e) {
      say(e.message);
    }
  };
  importDraft.onchange = async () => {
    if (designPreview) return;
    const file = importDraft.files?.[0];
    if (
      !file ||
      !workspaceReady ||
      workspaceConflict ||
      workspaceBusy ||
      workspaceLoading ||
      saving
    )
      return;
    let sent = false;
    clearTimeout(workspaceTimer);
    workspaceLoading = true;
    controls();
    try {
      if (file.size > 128 * 1024) throw Error("Yedek dosyası çok büyük.");
      const value = JSON.parse(await file.text());
      if (
        value?.schemaVersion !== 1 ||
        value.projectId !== document.body.dataset.project ||
        Object.keys(value).some(
          (key) =>
            !["schemaVersion", "projectId", "document", "layout"].includes(key),
        )
      )
        throw Error("Yedek biçimi veya proje eşleşmesi geçersiz.");
      if (
        !window.confirm(
          "Bu yedek, sizin düzenleme taslağınızın yerini alacak. Onaylar ve kurulu takımlar değişmeyecek. Devam edilsin mi?",
        )
      )
        return;
      sent = true;
      await window.api(
        "/team-workspace",
        {
          expectedRevision: workspaceRevision,
          document: value.document,
          layout: value.layout,
        },
        "PUT",
      );
      workspacePending = false;
      dirty = false;
      formDirty = false;
      workspaceLoading = false;
      await loadWorkspace(false);
      say(
        "Yedek sunucuda doğrulandı ve yalnız düzenleme taslağına alındı. Ayrı insan onayı hâlâ gerekir.",
      );
    } catch (e) {
      if (sent) {
        workspaceConflict = true;
        workspacePending = true;
      }
      say(
        "Yedek geri yüklenemedi: " +
          e.message +
          ". Açık taslak korunuyor; belirsiz kayıt için sunucudaki taslağı kontrol edin.",
      );
    } finally {
      workspaceLoading = false;
      importDraft.value = "";
      controls();
      if (!sent && workspacePending && !workspaceConflict)
        scheduleWorkspaceSave();
    }
  };
  function restoreLayout() {
    positions = new Map();
    if (designPreview) return;
    try {
      const rows = JSON.parse(
        sessionStorage.getItem(layoutStorageKey()) || "[]",
      );
      if (!Array.isArray(rows) || rows.length > 20) return;
      for (const [key, p] of rows)
        if (
          draft.members.some((m) => m.key === key) &&
          Number.isFinite(p.x) &&
          Number.isFinite(p.y) &&
          p.x >= 0 &&
          p.y >= 0 &&
          p.x <= 3800 &&
          p.y <= 3800
        )
          positions.set(key, { x: p.x, y: p.y });
    } catch {
      positions = new Map();
    }
  }
  function snapshot() {
    return {
      draft: structuredClone(draft),
      positions: structuredClone(positions),
      dirty,
      selected,
    };
  }
  function remember() {
    future = [];
    history.push(snapshot());
    if (history.length > 30) history.shift();
  }
  function initialPositions() {
    const depths = new Map(),
      counts = new Map();
    for (const m of draft.members) {
      const depth = m.parent === null ? 0 : (depths.get(m.parent) || 0) + 1;
      depths.set(m.key, depth);
      const column = counts.get(depth) || 0;
      counts.set(depth, column + 1);
      if (!positions.has(m.key))
        positions.set(m.key, { x: 32 + column * 220, y: 32 + depth * 180 });
    }
    for (const key of positions.keys())
      if (!draft.members.some((m) => m.key === key)) positions.delete(key);
  }
  const say = (text) => {
    notice.textContent = text;
    editorNotice.textContent = text;
  };
  function controls() {
    const locked = saving || workspaceLoading;
    undo.disabled = !history.length || locked;
    redo.disabled = !future.length || locked;
    save.disabled = !draft || !dirty || locked;
    for (const b of [department, specialist, apply, open])
      b.disabled = !draft || locked;
    template.disabled = locked;
    arrange.disabled = !draft || locked;
    newParent.disabled = !draft || locked;
    load.disabled = locked;
    workspaceLoad.disabled = workspaceBusy || locked;
    workspaceSave.disabled = workspaceBusy || locked;
    exportDraft.disabled = !draft || locked;
    importDraft.disabled =
      workspaceBusy || locked || !workspaceReady || workspaceConflict;
    search.disabled = locked;
    memberTasks.disabled = !draft || locked;
    remove.disabled = connectApply.disabled =
      !draft ||
      locked ||
      draft.members.find((m) => m.key === selected)?.kind === "manager";
    title.disabled = locked;
    for (const input of [name, purpose, output, budget, timeout, owner, saved])
      input.disabled = locked;
    parent.disabled =
      locked ||
      draft?.members.find((m) => m.key === selected)?.kind === "manager";
    discard.disabled = !formDirty || locked;
    for (const card of canvas.querySelectorAll("button"))
      card.disabled = locked;
    deleteYes.disabled = deleteNo.disabled = locked;
    if (designPreview) {
      for (const node of [
        normal,
        tasksTab,
        tasksPanel,
        operations,
        workspaceBar,
        library,
        save,
        memberTasks,
      ])
        node.remove();
      for (const control of [
        save,
        memberTasks,
        workspaceLoad,
        workspaceSave,
        exportDraft,
        importDraft,
        load,
        open,
        owner,
        saved,
      ])
        control.disabled = true;
    }
  }
  function checkForm() {
    if (formDirty)
      commit(editorDraft(), "Kart değişiklikleri taslağa uygulandı.");
  }
  function replace(value, message, storageKey = "template") {
    checkForm();
    if (
      dirty &&
      !window.confirm("Kaydedilmemiş takım taslağını bırakmak istiyor musunuz?")
    )
      return;
    draft = orderedTeam(value);
    baseline = structuredClone(draft);
    layoutKey = storageKey;
    restoreLayout();
    connectKey = null;
    selected = draft.members[0].key;
    history = [];
    future = [];
    collapsed.clear();
    dirty = false;
    render();
    persistLayout();
    say(message);
  }
  async function loadTemplate() {
    try {
      checkForm();
      if (designPreview) {
        replace(
          designPreviewTemplate,
          "Örnek tasarım yüklendi. Kalıcı kayıt yok; yenileme veya kapatma bütün değişiklikleri siler.",
        );
        return;
      }
      const r = await fetch(panelBase + "/team-template");
      if (!r.ok) throw Error("Şablon yüklenemedi.");
      replace(
        await r.json(),
        "Şablon taslağı — çalışan takım değildir. Düzenleyip yeni sürüm olarak onaya gönderin.",
      );
    } catch (e) {
      say(e.message);
    }
  }
  function activate(tree) {
    if (designPreview) tree = true;
    const tasks = tree === "tasks";
    const organization = tree === true;
    document.title = designPreview
      ? "Takım tasarım önizlemesi — kayıt ve çalıştırma yok"
      : organization
        ? "Takım Tasarımcısı — Serbest Yerleşim"
        : tasks
          ? "Takım görevleri — Yerel deneme"
          : "Yerel ajan denemesi";
    operations.hidden = organization || tasks;
    panel.hidden = !organization;
    tasksPanel.hidden = !tasks;
    for (const [tab, active] of [
      [treeTab, organization],
      [tasksTab, tasks],
      [normal, !tasks && !organization],
    ]) {
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    if (organization && !draft && !workspaceLoading) loadWorkspace(false);
    if (tasks && !designPreview) tasksView?.refresh();
  }
  normal.onclick = () => activate(false);
  treeTab.onclick = () => activate(true);
  tasksTab.onclick = () => activate("tasks");
  if (!designPreview)
    window.addEventListener("persona-open-tasks", () => activate("tasks"));
  nav.onkeydown = (e) => {
    if (designPreview) return;
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      const tabs = [normal, treeTab, tasksTab];
      const i =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? 2
            : (tabs.indexOf(document.activeElement) +
                (e.key === "ArrowLeft" ? 2 : 1)) %
              3;
      activate([false, true, "tasks"][i]);
      tabs[i].focus();
    }
  };
  function commit(value, message) {
    const valid = orderedTeam(value);
    remember();
    draft = valid;
    dirty = true;
    formDirty = false;
    render();
    persistLayout();
    say(message + " Henüz kaydedilmedi.");
  }
  function move(key, to) {
    try {
      checkForm();
      if (saving) return;
      commit(moveTeamMember(draft, key, to), "İlişki güncellendi.");
    } catch (e) {
      say(e.message);
    }
  }
  function render() {
    title.value = draft.name;
    canvas.replaceChildren();
    initialPositions();
    const surface = make("div", "", "", canvas);
    surface.className = "org-surface";
    const world = make("div", "org-world", "", surface);
    world.className = "org-world";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("org-links");
    svg.setAttribute("aria-hidden", "true");
    world.append(svg);
    const hidden = new Set();
    for (const m of draft.members)
      if (
        m.parent !== null &&
        (collapsed.has(m.parent) || hidden.has(m.parent))
      )
        hidden.add(m.key);
    for (const m of draft.members) {
      if (hidden.has(m.key)) continue;
      const node = make("div", "", "", world);
      node.className = "org-node";
      node.dataset.key = m.key;
      const card = make("button", "", m.name, node);
      card.className = "org-card";
      card.dataset.key = m.key;
      card.setAttribute("aria-pressed", String(selected === m.key));
      card.draggable = false;
      card.dataset.movable = "true";
      card.title = "Yerini değiştirmek için sürükle; düzenlemek için tıkla";
      make(
        "small",
        "",
        { manager: "Genel müdür", department: "Birim", specialist: "Uzman" }[
          m.kind
        ],
        card,
      ).className = "org-kind";
      if (draft.members.some((member) => member.parent === m.key)) {
        const toggle = make(
          "button",
          "",
          collapsed.has(m.key) ? "＋ Aç" : "− Daralt",
          node,
        );
        toggle.className = "org-collapse";
        toggle.dataset.key = m.key;
        toggle.setAttribute("aria-expanded", String(!collapsed.has(m.key)));
        toggle.setAttribute(
          "aria-label",
          m.name + " alt üyelerini aç veya daralt",
        );
        toggle.onclick = () => {
          try {
            checkForm();
            if (collapsed.has(m.key)) collapsed.delete(m.key);
            else collapsed.add(m.key);
            render();
          } catch (e) {
            say(e.message);
          }
        };
      }
      if (m.parent !== null) {
        const link = make("button", "", "↗ Bağla", node);
        link.className = "org-connect";
        link.setAttribute("aria-label", m.name + " için yönetici bağlantısı");
        link.onclick = () => {
          if (suppressClick || saving) return;
          try {
            checkForm();
          } catch (e) {
            say(e.message);
            return;
          }
          selected = m.key;
          render();
          connectKey = m.key;
          highlightTargets(m.key);
          say(
            "Yeşil/kesikli yönetici kartına tıklayın veya sağda “Bağlı olduğu birim” seçip “Seçilen yöneticiye bağla” düğmesine basın. İptal: Escape.",
          );
        };
      }
      card.onclick = () => {
        if (suppressClick) return;
        try {
          checkForm();
          if (connectKey) {
            const key = connectKey;
            connectKey = null;
            move(key, m.key);
            highlightTargets(null);
            return;
          }
          selected = m.key;
          render();
          [...canvas.querySelectorAll("button")]
            .find((b) => b.dataset.key === m.key)
            .focus();
        } catch (e) {
          say(e.message);
        }
      };
    }
    drawPositions();
    const m = draft.members.find((m) => m.key === selected);
    remove.textContent = draft.members.some((item) => item.parent === m.key)
      ? "Birimi sil; üyelerini üst birime taşı"
      : "Seçili üyeyi sil";
    const preferredParent = m.kind === "specialist" ? m.parent : m.key;
    newParent.replaceChildren();
    for (const member of draft.members.filter(
      (item) => item.kind !== "specialist",
    ))
      make("option", "", member.name, newParent).value = member.key;
    newParent.value = preferredParent;
    heading.textContent = m.name;
    name.value = m.name;
    purpose.value = m.purpose;
    output.value = m.output;
    budget.value = m.capMicros;
    timeout.value = m.timeoutSeconds;
    parent.replaceChildren();
    if (m.kind === "manager") {
      make("option", "", "En üst yönetici", parent).value = "";
    } else
      for (const candidate of draft.members) {
        if (candidate.kind === "specialist") continue;
        try {
          moveTeamMember(draft, m.key, candidate.key);
        } catch {
          continue;
        }
        make("option", "", candidate.name, parent).value = candidate.key;
      }
    parent.value = m.parent ?? "";
    parent.disabled = m.kind === "manager";
    formDirty = false;
    deleteBox.hidden = true;
    pendingDelete = null;
    changesList.replaceChildren();
    for (const line of baseline ? describeTeamChanges(baseline, draft) : [])
      make("li", "", line, changesList);
    if (!changesList.children.length)
      make(
        "li",
        "",
        designPreview
          ? "Örnek tasarıma göre değişiklik yok. Bu görünümde kurulu takım veya çalışma kaydı bulunmaz."
          : "Yüklenen taslağa göre değişiklik yok. Kurulu takım ayrıca Görevler ve sonuçlar ekranında gösterilir.",
        changesList,
      );
    updateSearch();
    if (!designPreview)
      window.dispatchEvent(
        new CustomEvent("persona-member-selected", {
          detail: { key: m.key, name: m.name },
        }),
      );
    controls();
  }
  function drawPositions() {
    const world = canvas.querySelector(".org-world"),
      svg = canvas.querySelector(".org-links");
    let width = 960,
      height = 650;
    for (const node of canvas.querySelectorAll(".org-node")) {
      const p = positions.get(node.dataset.key);
      node.style.left = p.x + "px";
      node.style.top = p.y + "px";
      width = Math.max(width, p.x + 240);
      height = Math.max(height, p.y + 180);
    }
    world.style.width = width + "px";
    world.style.height = height + "px";
    worldWidth = width;
    worldHeight = height;
    world.style.transform = "scale(" + zoom + ")";
    const surface = canvas.querySelector(".org-surface");
    surface.style.width = width * zoom + "px";
    surface.style.height = height * zoom + "px";
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.replaceChildren();
    for (const m of draft.members)
      if (
        m.parent !== null &&
        canvas.querySelector('.org-node[data-key="' + m.key + '"]') &&
        canvas.querySelector('.org-node[data-key="' + m.parent + '"]')
      ) {
        const from = positions.get(m.parent),
          to = positions.get(m.key);
        const line = document.createElementNS(svg.namespaceURI, "path");
        line.setAttribute("data-child", m.key);
        line.setAttribute(
          "d",
          "M " +
            (from.x + 90) +
            " " +
            (from.y + 90) +
            " C " +
            (from.x + 90) +
            " " +
            (from.y + 140) +
            ", " +
            (to.x + 90) +
            " " +
            (to.y - 50) +
            ", " +
            (to.x + 90) +
            " " +
            to.y,
        );
        svg.append(line);
      }
  }
  function setZoom(value, fit = false) {
    if (pointer || !draft) return;
    const x = (canvas.scrollLeft + canvas.clientWidth / 2) / zoom,
      y = (canvas.scrollTop + canvas.clientHeight / 2) / zoom;
    zoom = Math.max(0.25, Math.min(2, Math.round(value * 100) / 100));
    drawPositions();
    canvas.scrollLeft = fit ? 0 : x * zoom - canvas.clientWidth / 2;
    canvas.scrollTop = fit ? 0 : y * zoom - canvas.clientHeight / 2;
    zoomLabel.textContent = Math.round(zoom * 100) + "%";
    zoomOut.disabled = zoom <= 0.25;
    zoomIn.disabled = zoom >= 2;
  }
  zoomOut.onclick = () => {
    setZoom(zoom - 0.25);
    scheduleWorkspaceSave();
  };
  zoomIn.onclick = () => {
    setZoom(zoom + 0.25);
    scheduleWorkspaceSave();
  };
  zoomReset.onclick = () => {
    setZoom(1);
    scheduleWorkspaceSave();
  };
  zoomFit.onclick = () => {
    setZoom(
      Math.min(
        (canvas.clientWidth - 32) / worldWidth,
        (canvas.clientHeight - 32) / worldHeight,
      ),
      true,
    );
    scheduleWorkspaceSave();
  };
  function updateSearch() {
    searchResults.replaceChildren();
    const query = search.value.trim().toLocaleLowerCase("tr");
    if (!draft || !query) return;
    const matches = draft.members.filter((m) =>
      m.name.toLocaleLowerCase("tr").includes(query),
    );
    for (const member of matches) {
      const result = make("button", "", member.name, searchResults);
      result.onclick = () => {
        try {
          checkForm();
          selected = member.key;
          let ancestor = member.parent;
          while (ancestor) {
            collapsed.delete(ancestor);
            ancestor = draft.members.find((m) => m.key === ancestor)?.parent;
          }
          render();
          const card = [...canvas.querySelectorAll(".org-card")].find(
            (c) => c.dataset.key === member.key,
          );
          card?.scrollIntoView({ block: "nearest", inline: "nearest" });
          card?.focus({ preventScroll: true });
        } catch (e) {
          say(e.message);
        }
      };
    }
    if (!matches.length)
      make("p", "", "Eşleşen üye bulunamadı.", searchResults);
  }
  search.oninput = updateSearch;
  memberTasks.onclick = () => {
    if (designPreview) return;
    try {
      checkForm();
      window.dispatchEvent(
        new CustomEvent("persona-open-tasks", {
          detail: {
            key: selected,
            name: draft.members.find((m) => m.key === selected).name,
          },
        }),
      );
    } catch (e) {
      say(e.message);
    }
  };
  discard.onclick = () => {
    formDirty = false;
    render();
    scheduleWorkspaceSave();
    say("Uygulanmamış kart değişiklikleri bırakıldı.");
  };
  function highlightTargets(key) {
    for (const card of canvas.querySelectorAll(".org-card")) {
      card.classList.remove("org-drop-target", "org-drop-allowed");
      if (key)
        try {
          moveTeamMember(draft, key, card.dataset.key);
          card.classList.add("org-drop-allowed");
        } catch {}
    }
  }
  arrange.onclick = () => {
    try {
      checkForm();
      if (saving) return;
      remember();
      positions = new Map();
      render();
      persistLayout();
      say("Kartlar otomatik yerleştirildi. Ekip ilişkileri değişmedi.");
    } catch (e) {
      say(e.message);
    }
  };
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      connectKey = null;
      highlightTargets(null);
      if (pointer) {
        positions = pointer.before.positions;
        clearDrag();
        drawPositions();
      }
      say("Bağlantı veya taşıma iptal edildi.");
    }
  });
  // Card body moves coordinates only; a separate connector changes hierarchy.
  let pointer = null,
    suppressClick = false;
  function targetAt(x, y) {
    const card = document.elementFromPoint(x, y)?.closest(".org-card");
    if (!card || !canvas.contains(card) || !pointer) return null;
    try {
      moveTeamMember(draft, pointer.key, card.dataset.key);
      return card;
    } catch {
      return null;
    }
  }
  function clearDrag() {
    for (const card of canvas.querySelectorAll(".org-card")) {
      card.classList.remove(
        "org-dragging",
        "org-drop-target",
        "org-drop-allowed",
      );
    }
    pointer = null;
    canvas.classList.remove("org-panning");
  }
  canvas.addEventListener("pointerdown", (e) => {
    const node = e.target.closest(".org-node"),
      card = node?.querySelector(".org-card");
    if (
      e.button !== 0 ||
      saving ||
      workspaceLoading ||
      pointer ||
      !draft ||
      e.target.closest(".org-collapse")
    )
      return;
    try {
      checkForm();
    } catch (error) {
      say(error.message);
      return;
    }
    if (!card) {
      pointer = {
        id: e.pointerId,
        mode: "pan",
        x: e.clientX,
        y: e.clientY,
        sx: canvas.scrollLeft,
        sy: canvas.scrollTop,
        active: false,
        before: snapshot(),
      };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    pointer = {
      id: e.pointerId,
      key: card.dataset.key,
      x: e.clientX,
      y: e.clientY,
      sx: canvas.scrollLeft,
      sy: canvas.scrollTop,
      active: false,
      card,
      node,
      mode: e.target.closest(".org-connect") ? "connect" : "position",
      before: snapshot(),
      start: { ...positions.get(card.dataset.key) },
    };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!pointer || pointer.id !== e.pointerId) return;
    if (
      !pointer.active &&
      Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) < 6
    )
      return;
    pointer.active = true;
    e.preventDefault();
    if (pointer.mode === "pan") {
      canvas.classList.add("org-panning");
      canvas.scrollLeft = pointer.sx - (e.clientX - pointer.x);
      canvas.scrollTop = pointer.sy - (e.clientY - pointer.y);
      return;
    }
    if (pointer.mode === "position") {
      positions.set(pointer.key, {
        x: Math.max(
          0,
          Math.min(
            3800,
            pointer.start.x +
              (e.clientX - pointer.x + canvas.scrollLeft - pointer.sx) / zoom,
          ),
        ),
        y: Math.max(
          0,
          Math.min(
            3800,
            pointer.start.y +
              (e.clientY - pointer.y + canvas.scrollTop - pointer.sy) / zoom,
          ),
        ),
      });
      drawPositions();
      say(
        "Boş alana bırakın; kart burada kalacak. Yönetici bağlantısı değişmez.",
      );
      return;
    }
    highlightTargets(pointer.key);
    const target = targetAt(e.clientX, e.clientY);
    if (target) target.classList.add("org-drop-target");
    say(
      target
        ? "Bırakın: " +
            draft.members.find((m) => m.key === target.dataset.key).name +
            " altına bağlanacak."
        : "Kartı vurgulanan birim veya yönetici kartının üzerine bırakın.",
    );
  });
  canvas.addEventListener("pointerup", (e) => {
    if (!pointer || pointer.id !== e.pointerId) return;
    const current = pointer,
      target = targetAt(e.clientX, e.clientY);
    if (canvas.hasPointerCapture(e.pointerId))
      canvas.releasePointerCapture(e.pointerId);
    clearDrag();
    if (current.mode === "pan") return;
    if (current.active) {
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 0);
      if (current.mode === "position") {
        future = [];
        history.push(current.before);
        if (history.length > 30) history.shift();
        persistLayout();
        controls();
        say("Kartın yeri korundu. Yönetici bağlantısı değişmedi.");
      } else if (target) move(current.key, target.dataset.key);
      else
        say(
          "Taşıma yapılmadı. Bir birim veya yönetici kartının üzerine bırakın.",
        );
    } else if (current.mode === "connect")
      current.node.querySelector(".org-connect").click();
    else current.card.click();
  });
  function cancelDrag() {
    if (pointer) {
      positions = pointer.before.positions;
      clearDrag();
      drawPositions();
    }
  }
  canvas.addEventListener("pointercancel", cancelDrag);
  canvas.addEventListener("lostpointercapture", cancelDrag);
  for (const input of [name, parent, purpose, output, budget, timeout])
    input.oninput = () => {
      formDirty = true;
      dirty = true;
      controls();
      scheduleWorkspaceSave();
      say(
        "Geçerli kart değişiklikleri otomatik kaydedilir; başka karta geçerken uygulanır.",
      );
    };
  function editorDraft() {
    const next = structuredClone(draft),
      m = next.members.find((m) => m.key === selected),
      cap = Number(budget.value),
      seconds = Number(timeout.value);
    if (!name.value.trim() || !purpose.value.trim() || !output.value.trim())
      throw Error("Ad, görev ve beklenen çıktı boş olamaz.");
    if (
      !Number.isInteger(cap) ||
      cap < 1 ||
      cap > 1000000 ||
      !Number.isInteger(seconds) ||
      seconds < 1 ||
      seconds > 30
    )
      throw Error("Bütçe 1–1.000.000; süre 1–30 arasında tam sayı olmalı.");
    Object.assign(m, {
      name: name.value.trim(),
      purpose: purpose.value.trim(),
      output: output.value.trim(),
      parent: m.kind === "manager" ? null : parent.value,
      capMicros: cap,
      timeoutSeconds: seconds,
    });
    return orderedTeam(next);
  }
  apply.onclick = () => {
    try {
      if (saving) return;
      commit(editorDraft(), "Kart güncellendi.");
    } catch (e) {
      say(e.message);
    }
  };
  connectApply.onclick = () => {
    connectKey = null;
    apply.onclick();
  };
  remove.onclick = () => {
    try {
      checkForm();
      if (saving) return;
      const member = draft.members.find((m) => m.key === selected);
      if (member.parent === null) throw Error("Genel müdür silinemez.");
      const children = draft.members.filter((m) => m.parent === selected);
      const target = draft.members.find((m) => m.key === member.parent);
      deleteText.textContent =
        member.name +
        " yalnız düzenleme taslağından çıkarılacak. " +
        (children.length
          ? children.map((m) => m.name).join(", ") +
            " → " +
            target.name +
            " altına taşınacak."
          : "Alt üyesi yok.") +
        (designPreview
          ? " Yalnız bu sekmedeki örnek tasarım değişir; hiçbir kayıt veya çalışan görev yoktur."
          : " Kurulu takım ve çalışan görevler değişmeyecek.");
      pendingDelete = selected;
      deleteBox.hidden = false;
      deleteNo.focus();
    } catch (e) {
      say(e.message);
    }
  };
  deleteNo.onclick = () => {
    pendingDelete = null;
    deleteBox.hidden = true;
    remove.focus();
  };
  deleteYes.onclick = () => {
    try {
      if (!pendingDelete || saving || formDirty)
        throw Error("Silme etkisini yeniden inceleyin.");
      const member = draft.members.find((m) => m.key === pendingDelete),
        next = removeTeamMember(draft, pendingDelete);
      selected = member.parent;
      connectKey = null;
      commit(
        next,
        "Üye taslaktan çıkarıldı; varsa alt üyeler üst birime bağlandı. Geri alabilirsiniz.",
      );
    } catch (e) {
      say(e.message);
    }
  };
  title.onchange = () => {
    try {
      checkForm();
      if (!title.value.trim()) throw Error("Takım adı boş olamaz.");
      commit({ ...draft, name: title.value.trim() }, "Takım adı değişti.");
    } catch (e) {
      say(e.message);
    }
  };
  title.oninput = () => {
    dirty = true;
    controls();
    scheduleWorkspaceSave();
  };
  function add(kind) {
    try {
      checkForm();
      if (saving) return;
      if (draft.members.length >= 20)
        throw Error("En fazla 20 üye eklenebilir.");
      const container = draft.members.find((m) => m.key === newParent.value);
      if (!container || container.kind === "specialist")
        throw Error("Yeni üyenin bağlanacağı yönetici veya birimi seçin.");
      const next = structuredClone(draft),
        key = "member_" + crypto.randomUUID().replaceAll("-", "").slice(0, 16);
      next.members.push({
        ...structuredClone(next.members[0]),
        key,
        name: kind === "department" ? "Yeni birim" : "Yeni uzman",
        kind,
        parent: container.key,
      });
      selected = key;
      commit(next, "Yeni üye eklendi.");
      [...canvas.querySelectorAll(".org-node")]
        .find((node) => node.dataset.key === key)
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
      name.focus({ preventScroll: true });
      name.select();
    } catch (e) {
      say(e.message);
    }
  }
  department.onclick = () => add("department");
  specialist.onclick = () => add("specialist");
  undo.onclick = () => {
    try {
      checkForm();
      if (!history.length || saving) return;
      const previous = history.pop();
      future.push(snapshot());
      draft = previous.draft;
      positions = previous.positions;
      dirty = previous.dirty;
      selected = previous.selected;
      if (!draft.members.some((m) => m.key === selected))
        selected = draft.members[0].key;
      render();
      persistLayout();
      say("Son değişiklik geri alındı.");
    } catch (e) {
      say(e.message);
    }
  };
  redo.onclick = () => {
    try {
      checkForm();
      if (!future.length || saving) return;
      history.push(snapshot());
      const next = future.pop();
      draft = next.draft;
      positions = next.positions;
      dirty = next.dirty;
      selected = next.selected;
      if (!draft.members.some((m) => m.key === selected))
        selected = draft.members[0].key;
      render();
      persistLayout();
      say("Değişiklik yeniden yapıldı.");
    } catch (e) {
      say(e.message);
    }
  };
  template.onclick = loadTemplate;
  load.onclick = async () => {
    if (designPreview) return;
    load.disabled = true;
    try {
      const people = await window.api("/personas"),
        records = await window.api("/team-drafts");
      owner.replaceChildren();
      for (const p of people) make("option", "", p.name, owner).value = p.id;
      rows = records;
      saved.replaceChildren();
      for (const r of rows)
        make(
          "option",
          "",
          r.document.name +
            " · #" +
            r.action_id +
            (r.reviewer ? " · onaylı" : " · onay bekliyor"),
          saved,
        ).value = r.action_id;
      say("Kayıtlar yüklendi. Düzenlemek için taslağı seçip açın.");
    } catch (e) {
      say(e.message);
    } finally {
      load.disabled = false;
    }
  };
  open.onclick = () => {
    try {
      const r = rows.find((r) => String(r.action_id) === saved.value);
      if (!r) throw Error("Önce kayıtlı taslakları yükleyip seçin.");
      replace(
        r.document,
        "#" +
          r.action_id +
          " düzenleme kopyası; değişiklikler yeni onay gerektirir.",
        "draft:" + r.action_id,
      );
    } catch (e) {
      say(e.message);
    }
  };
  save.onclick = async () => {
    if (designPreview) return;
    try {
      checkForm();
      if (!dirty || saving) return;
      const personaId = Number(owner.value);
      if (!Number.isSafeInteger(personaId) || personaId < 1) {
        library.open = true;
        throw Error(
          "Önce kayıtlı taslakları yükleyin ve kayıt sorumlusunu seçin.",
        );
      }
      saving = true;
      controls();
      const result = await window.api("/team-drafts", {
        personaId,
        document: orderedTeam(draft),
      });
      layoutKey = "draft:" + result.actionId;
      persistLayout();
      dirty = false;
      baseline = structuredClone(draft);
      say(
        "Yeni taslak #" +
          result.actionId +
          " kaydedildi. Ayrı insan onayı gerekiyor; çalışan takım ve yetkiler değişmedi.",
      );
    } catch (e) {
      say(e.message);
    } finally {
      saving = false;
      controls();
    }
  };
  window.addEventListener("beforeunload", (e) => {
    if (designPreview) return;
    if (workspacePending || workspaceBusy || (formDirty && !workspaceReady)) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  activate(
    new URLSearchParams(window.location.search).get("view") ===
      "team-workspace",
  );
  controls();
}
