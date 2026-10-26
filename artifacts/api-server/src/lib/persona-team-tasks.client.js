// Deliberately local/mock-only: the caller supplies the existing authenticated,
// project-scoped API. This module never selects actors or issues access grants.
const positiveId = (value) =>
  Number.isSafeInteger(Number(value)) && Number(value) > 0;
const hash = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const uuid = (value) =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const canonical = (value) =>
  JSON.stringify(value, function (_key, item) {
    return item && !Array.isArray(item) && typeof item === "object"
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item;
  });

/** Incomplete/ambiguous source bindings are not assignable. Card names and
 * local graph positions are deliberately not an identity or authority source. */
export function installedTeamChoices(rows, drafts) {
  if (!Array.isArray(rows) || !Array.isArray(drafts)) return [];
  const groups = new Map();
  for (const row of rows) {
    if (!uuid(row?.id)) continue;
    const group = groups.get(row.id) || [];
    group.push(row);
    groups.set(row.id, group);
  }
  const result = [];
  for (const [id, members] of groups) {
    const first = members[0];
    const sources = drafts.filter(
      (draft) => Number(draft.action_id) === Number(first.draft_id),
    );
    if (sources.length !== 1) continue;
    const source = sources[0];
    const definitions = source.document?.members;
    if (
      !positiveId(first.draft_id) ||
      !source.reviewer ||
      !hash(source.digest) ||
      !["PAUSED", "MOCK_READY"].includes(first.status) ||
      !Array.isArray(definitions) ||
      definitions.length !== members.length ||
      definitions.length > 20 ||
      new Set(definitions.map((item) => item.key)).size !==
        definitions.length ||
      members.some(
        (row) =>
          row.status !== first.status ||
          Number(row.draft_id) !== Number(first.draft_id) ||
          canonical(row.document) !== canonical(source.document),
      )
    )
      continue;
    const bound = definitions.map((definition) => {
      const matches = members.filter(
        (row) =>
          row.member_key === definition.key &&
          row.parent_key === definition.parent,
      );
      if (matches.length !== 1 || !positiveId(matches[0].persona_id))
        return null;
      return { ...definition, personaId: Number(matches[0].persona_id) };
    });
    if (
      bound.some((member) => !member) ||
      new Set(bound.map((member) => member.personaId)).size !== bound.length
    )
      continue;
    result.push({
      id,
      draftId: Number(source.action_id),
      digest: source.digest,
      status: first.status,
      name: source.document.name,
      members: bound,
    });
  }
  return result;
}

export function describeTeamChanges(before, after) {
  const changes = [];
  if (before?.name !== after?.name) changes.push("Takım adı değişti.");
  const oldMembers = new Map(
    (before?.members || []).map((member) => [member.key, member]),
  );
  const newMembers = new Map(
    (after?.members || []).map((member) => [member.key, member]),
  );
  const fields = {
    name: "adı",
    parent: "bağlı olduğu yönetici",
    kind: "rol türü",
    purpose: "talimatları",
    output: "beklenen çıktısı",
    capMicros: "deneme bütçesi",
    timeoutSeconds: "süre sınırı",
    tools: "araç sınırları",
    dataScopes: "veri sınırları",
    provider: "sağlayıcısı",
    model: "modeli",
    humanApproval: "insan onayı şartı",
    concurrency: "eşzamanlı iş sınırı",
  };
  for (const [key, member] of newMembers) {
    const old = oldMembers.get(key);
    if (!old) {
      changes.push(`${member.name}: yeni üye.`);
      continue;
    }
    for (const [field, label] of Object.entries(fields)) {
      if (canonical(old[field]) !== canonical(member[field]))
        changes.push(`${member.name}: ${label} değişti.`);
    }
  }
  for (const [key, member] of oldMembers)
    if (!newMembers.has(key)) changes.push(`${member.name}: çıkarıldı.`);
  return changes.length ? changes : ["İki kayıt arasında içerik farkı yok."];
}

export function mockCostLabel(value) {
  if (
    (typeof value !== "number" &&
      (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value))) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < 0
  )
    return "Henüz doğrulanmadı";
  return `${Number(value).toLocaleString("tr-TR")} sahte mikro birim`;
}

export function taskStateLabel(value) {
  return (
    {
      pending_approval: "İnsan onayı bekliyor",
      approved: "Onaylandı · çalıştırılmadı",
      executed: "İşlendi",
      rejected: "Reddedildi / iptal edildi",
      SUCCEEDED: "Tamamlandı",
      COMPLETED: "Tamamlandı",
      RESERVED: "Bütçe ayrıldı",
      DISPATCHED: "Çalışıyor / sonuç bekleniyor",
      UNCERTAIN: "Sonuç belirsiz · kontrol gerekiyor",
      QUEUED: "Sırada",
      RUNNING: "Çalışıyor",
      AWAITING_APPROVAL: "İnsan onayı bekliyor",
      BLOCKED: "İnceleme gerekiyor",
      CANCELLED: "İptal edildi",
      PAUSED: "Duraklatılmış",
      MOCK_READY: "Yalnız sahte görev için açık",
    }[value] || "Durum doğrulanmalı"
  );
}

const friendlyError = (error) => {
  const known = {
    PERSONA_SELF_APPROVAL_DENIED:
      "Kendi hazırladığınız işi onaylayamazsınız. Ayrı yetkili insan oturumu gerekir.",
    PERSONA_SELF_APPROVAL: "Sonuç için ayrı yetkili insan onayı gerekir.",
    PERSONA_OWNERSHIP_REQUIRED:
      "Üye kullanıma kapalı veya bu projedeki çalışma yetkisi doğrulanamadı.",
    PERSONA_APPROVAL_STALE:
      "Onay süresi dolmuş veya içerik değişmiş. Güncel kaydı yeniden inceleyin.",
    PERSONA_APPROVAL_REQUIRED:
      "Çalıştırmadan önce geçerli, ayrı insan onayı gerekir.",
    PERSONA_RECONCILIATION_REQUIRED:
      "Sonuç belirsiz. Tekrar çalıştırmadan mevcut kanıt kontrol edilmeli.",
    PERSONA_AUTH_REQUIRED: "Oturum doğrulanamadı. Yeniden giriş gerekir.",
    PERSONA_BUDGET_EXCEEDED:
      "Üye veya proje bütçesi yeterli değil. İş tekrar çalıştırılmadı.",
  };
  return (
    known[error?.message] ||
    "İşlem tamamlandığı doğrulanamadı. Otomatik tekrar yapılmadı; kayıtları yenileyip sonucu kontrol edin."
  );
};

export function initializeTeamTasks({ container, api }) {
  if (!container?.ownerDocument || typeof api !== "function")
    throw new Error("TASK_PANEL_ARGUMENTS_REQUIRED");
  const doc = container.ownerDocument,
    win = doc.defaultView;
  const node = (tag, text, id) => {
    const el = doc.createElement(tag);
    if (text) el.textContent = text;
    if (id) el.id = id;
    return el;
  };
  const button = (text, id) => {
    const el = node("button", text, id);
    el.type = "button";
    return el;
  };
  const field = (parent, label, tag, id) => {
    const input = node(tag, "", id);
    const caption = node("label", label);
    caption.htmlFor = id;
    parent.append(caption, input);
    return input;
  };
  const section = (title, id) => {
    const box = node("section", "", id);
    box.append(node("h2", title));
    container.append(box);
    return box;
  };
  const paragraph = (parent, label, value) => {
    const p = node("p"),
      strong = node("strong", `${label}: `);
    p.append(strong, doc.createTextNode(String(value ?? "Belirtilmedi")));
    parent.append(p);
  };
  const option = (select, value, label) => {
    const item = node("option", label);
    item.value = String(value);
    select.append(item);
  };
  const empty = (parent, text) => parent.append(node("p", text));
  let data = {
    teams: [],
    drafts: [],
    proposals: [],
    history: [],
    workflows: [],
  };
  let busy = false,
    loaded = false,
    disposed = false,
    readVersion = 0,
    refreshRequired = false;
  let reviewed = null,
    versionReviewed = null;
  container.classList.add("persona-tasks");
  container.append(
    node("h2", "Takımlar, görevler ve sonuçlar"),
    node(
      "p",
      "Yalnız sahte sağlayıcılı deneme. Bu ekran gerçek model çağrısı, yayın veya gönderim yapmaz. Onay, görevi hazırlayandan farklı yetkili insan tarafından verilir.",
    ),
  );
  const refreshButton = button("Kayıtları yenile", "tasks-refresh");
  const status = node(
    "p",
    "Kayıtları yüklemek için yenileyin.",
    "tasks-status",
  );
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  container.append(refreshButton, status);
  const assignment = section("1. Kurulmuş üyeye görev ver", "tasks-assignment");
  const selectionNotice = node(
    "p",
    "Şemadaki taslak ile kurulmuş takım ayrıdır. Görevin gerçek muhatabını aşağıdaki kayıtlardan seçin.",
    "tasks-selection-notice",
  );
  assignment.append(selectionNotice);
  const teamSelect = field(
    assignment,
    "Kurulmuş takım",
    "select",
    "tasks-team",
  );
  const teamState = node("p", "", "tasks-team-state");
  assignment.append(teamState);
  const teamPause = button(
    "Takımın sahte çalışma durumunu değiştir",
    "tasks-team-pause",
  );
  assignment.append(teamPause);
  const memberSelect = field(
    assignment,
    "Görevi yapacak üye",
    "select",
    "tasks-member",
  );
  const memberInfo = node("div", "", "tasks-member-info");
  assignment.append(memberInfo);
  const brief = field(
    assignment,
    "Ne hazırlanmasını istiyorsunuz?",
    "textarea",
    "tasks-brief",
  );
  brief.rows = 4;
  brief.maxLength = 16000;
  assignment.append(
    node(
      "p",
      "Hedef sabit: yalnız yerel taslak. Bütçe ve araç sınırları sunucuda yeniden kontrol edilir.",
    ),
  );
  const proposeButton = button("Görevi insan onayına gönder", "tasks-propose");
  assignment.append(proposeButton);
  const pending = section("2. Görevleri incele ve onayla", "tasks-pending");
  const proposalList = node("div", "", "tasks-proposals"),
    reviewBox = node("div", "", "tasks-review");
  pending.append(proposalList, reviewBox);
  const historySection = section("3. Çalışma sonuçları", "tasks-results");
  const historyList = node("div", "", "tasks-history");
  historySection.append(historyList);
  const versions = section(
    "Takım sürümleri ve kurulum",
    "tasks-version-section",
  );
  versions.append(
    node(
      "p",
      "Takımı onaya gönder seçeneği, düzenlediğiniz taslağın ayrı bir sürümünü oluşturur. Onaylamak mevcut takımı değiştirmez; kurulum ayrıca yapılır ve duraklatılmış başlar.",
    ),
  );
  const versionSelect = field(
    versions,
    "İncelenecek kayıtlı sürüm",
    "select",
    "tasks-versions",
  );
  const compareSelect = field(
    versions,
    "İsteğe bağlı: karşılaştırılacak kayıtlı sürüm",
    "select",
    "tasks-version-compare",
  );
  const versionPreview = node("div", "", "tasks-version-preview");
  versions.append(versionPreview);
  const versionReview = button(
    "Bu sürümün içeriğini incele",
    "tasks-version-review",
  );
  const versionConfirmLabel = node(
    "label",
    "Sürümün üyelerini, talimatlarını ve sınırlarını okudum.",
  );
  const versionConfirm = node("input", "", "tasks-version-confirm");
  versionConfirm.type = "checkbox";
  versionConfirmLabel.prepend(versionConfirm);
  const versionApprove = button(
    "İncelenen sürümü onayla",
    "tasks-version-approve",
  );
  const versionInstall = button(
    "Onaylı sürümü duraklatılmış kur",
    "tasks-version-install",
  );
  versions.append(
    versionReview,
    versionConfirmLabel,
    versionApprove,
    versionInstall,
  );
  const workflowSection = section(
    "Çok adımlı görevlerin durumu",
    "tasks-workflows-section",
  );
  const workflowList = node("div", "", "tasks-workflows");
  workflowSection.append(workflowList);

  const currentTeam = () =>
    data.teams.find((team) => team.id === teamSelect.value);
  const currentMember = () =>
    currentTeam()?.members.find(
      (member) => String(member.personaId) === memberSelect.value,
    );
  const currentDraft = () =>
    data.drafts.find((row) => String(row.action_id) === versionSelect.value);
  function controls() {
    const unavailable = busy || !loaded || refreshRequired;
    container.setAttribute("aria-busy", String(busy));
    refreshButton.disabled = busy;
    for (const control of container.querySelectorAll(
      "button,select,input,textarea",
    )) {
      if (control === refreshButton) continue;
      control.disabled = unavailable || control.dataset.ineligible === "true";
    }
    proposeButton.disabled =
      unavailable ||
      currentTeam()?.status !== "MOCK_READY" ||
      !currentMember() ||
      !brief.value.trim();
    teamPause.disabled = unavailable || !currentTeam();
    versionReview.disabled = unavailable || !currentDraft();
    versionConfirm.disabled = unavailable || !versionReviewed;
    versionApprove.disabled =
      unavailable ||
      !versionReviewed ||
      !versionConfirm.checked ||
      !!currentDraft()?.reviewer;
    versionInstall.disabled =
      unavailable ||
      !versionReviewed ||
      !versionConfirm.checked ||
      !currentDraft()?.reviewer;
  }
  function renderMembers() {
    const previous = memberSelect.value;
    memberSelect.replaceChildren();
    option(memberSelect, "", "Bir üye seçin");
    const team = currentTeam();
    for (const member of team?.members || [])
      option(
        memberSelect,
        member.personaId,
        `${member.name} · ${member.kind === "manager" ? "Yönetici" : member.kind === "department" ? "Birim" : "Uzman"}`,
      );
    if (team?.members.some((member) => String(member.personaId) === previous))
      memberSelect.value = previous;
    teamState.textContent = team
      ? `${taskStateLabel(team.status)}. Kaynak: kayıtlı sürüm ${team.draftId}. ${team.status === "PAUSED" ? "Bu takım duraklatılmış; görev başlatılamaz." : "Gerçek sağlayıcılar kapalı."}`
      : "Henüz onaylı ve kaynak bağı doğrulanmış takım seçilmedi.";
    teamPause.textContent =
      team?.status === "PAUSED"
        ? "Yalnız sahte görev almaya aç"
        : "Takımı duraklat";
    renderMemberInfo();
  }
  function renderMemberInfo() {
    memberInfo.replaceChildren();
    const member = currentMember();
    if (member) {
      paragraph(memberInfo, "Talimat", member.purpose);
      paragraph(memberInfo, "Beklenen çıktı", member.output);
      paragraph(
        memberInfo,
        "Deneme bütçesi sınırı",
        mockCostLabel(member.capMicros),
      );
    }
    controls();
  }
  function renderDraft() {
    versionReviewed = null;
    versionConfirm.checked = false;
    versionPreview.replaceChildren();
    const selected = currentDraft();
    if (!selected) {
      empty(
        versionPreview,
        "İncelenecek takım sürümü yok. Yukarıda takımınızı düzenleyin, Kaydet'e basın ve Takımı onaya gönder'i seçin. Diğer yönetici bu bölümden onaylayabilir.",
      );
      controls();
      return;
    }
    paragraph(
      versionPreview,
      "Onay",
      selected.reviewer ? "Ayrı insan tarafından onaylanmış" : "Bekliyor",
    );
    const compared = data.drafts.find(
      (row) => String(row.action_id) === compareSelect.value,
    );
    if (compared) {
      const changes = node("ul");
      for (const change of describeTeamChanges(
        compared.document,
        selected.document,
      ))
        changes.append(node("li", change));
      versionPreview.append(changes);
    }
    for (const member of selected.document?.members || []) {
      const detail = node("details");
      detail.append(node("summary", member.name));
      const parent = selected.document.members.find(
        (item) => item.key === member.parent,
      );
      paragraph(detail, "Bağlı olduğu", parent?.name || "Takım kökü");
      paragraph(detail, "Talimat", member.purpose);
      paragraph(detail, "Beklenen çıktı", member.output);
      paragraph(detail, "Deneme bütçesi", mockCostLabel(member.capMicros));
      paragraph(
        detail,
        "Araç ve veri sınırı",
        "Yalnız sahte taslak ve bu projenin sahte bağlamı. İnsan onayı zorunlu.",
      );
      versionPreview.append(detail);
    }
    controls();
  }
  function renderProposals() {
    proposalList.replaceChildren();
    reviewBox.replaceChildren();
    reviewed = null;
    if (!data.proposals.length)
      empty(
        proposalList,
        "Henüz görev yok. Yeni görev yukarıdan oluşturulabilir.",
      );
    for (const row of data.proposals) {
      if (!positiveId(row.actionId)) continue;
      const article = node("article");
      article.dataset.actionId = String(row.actionId);
      article.append(
        node("h3", row.intent?.content?.slice(0, 100) || "Taslak görevi"),
      );
      paragraph(
        article,
        "Durum",
        row.consumedBy
          ? "Çalışma kaydı oluştu · sonucu aşağıdan kontrol edin"
          : taskStateLabel(row.status),
      );
      const inspect = button("İçeriği incele");
      inspect.dataset.operation = "review";
      inspect.onclick = () => readProposal(row.actionId);
      article.append(inspect);
      proposalList.append(article);
    }
  }
  function renderHistory() {
    historyList.replaceChildren();
    if (!data.history.length)
      empty(
        historyList,
        "Henüz çalışma sonucu yok. Onaylanan görev ayrıca sahte çalıştırılmalıdır.",
      );
    for (const row of data.history) {
      const article = node("article");
      article.dataset.executionId = row.id;
      const member = data.teams
        .flatMap((team) => team.members)
        .find((item) => item.personaId === Number(row.persona_id));
      article.append(node("h3", member?.name || "Proje çalışma kaydı"));
      paragraph(article, "Durum", taskStateLabel(row.state));
      paragraph(article, "Ayrılan bütçe", mockCostLabel(row.reserved_micros));
      paragraph(
        article,
        "Doğrulanan maliyet",
        mockCostLabel(row.actual_micros),
      );
      const output = row.output_payload?.output;
      if (typeof output === "string") paragraph(article, "Sahte çıktı", output);
      else if (row.state === "SUCCEEDED")
        empty(article, "Bu kayıtta gösterilebilir metin çıktısı bulunmuyor.");
      if (
        ["RESERVED", "DISPATCHED", "UNCERTAIN"].includes(row.state) &&
        uuid(row.id)
      ) {
        empty(article, "Otomatik iade veya yeniden çalıştırma yapılmaz.");
        const reconcile = button("Mevcut sonuç kanıtını kontrol et");
        reconcile.onclick = () =>
          mutate(
            () => api(`/reconcile/${row.id}`, {}),
            "Sonuç kanıtı kontrol edildi; görev tekrar çalıştırılmadı.",
          );
        article.append(reconcile);
      }
      historyList.append(article);
    }
  }
  function renderWorkflows() {
    workflowList.replaceChildren();
    if (!data.workflows.length)
      empty(
        workflowList,
        "Henüz çok adımlı görev yok. Organizasyon şeması tek başına otomatik iş dağıtımı başlatmaz.",
      );
    for (const row of data.workflows) {
      if (!positiveId(row.actionId)) continue;
      const article = node("article");
      article.append(node("h3", row.name));
      paragraph(article, "Durum", taskStateLabel(row.state));
      const show = button("Adımları ve sonuçları göster");
      const details = node("div");
      show.onclick = () =>
        read(async () => {
          const value = await api(`/workflows/${row.actionId}`);
          details.replaceChildren();
          for (const step of value.nodes || []) {
            const member = data.teams
              .flatMap((team) => team.members)
              .find((item) => item.personaId === step.personaId);
            paragraph(
              details,
              member?.name || step.key,
              taskStateLabel(step.status),
            );
            if (typeof step.output_payload?.output === "string")
              paragraph(details, "Sahte çıktı", step.output_payload.output);
          }
          empty(
            details,
            value.review
              ? "Sonuç ayrıca insan tarafından incelenmiş."
              : "Sonuç için ayrı insan incelemesi henüz yok.",
          );
        });
      article.append(show, details);
      workflowList.append(article);
    }
  }
  async function load() {
    const values = await Promise.all([
      api("/teams"),
      api("/team-drafts"),
      api("/proposals"),
      api("/history"),
      api("/workflows"),
    ]);
    if (disposed) return;
    if (values.some((value) => !Array.isArray(value)))
      throw new Error("TASK_PANEL_INVALID_RESPONSE");
    const previousTeam = teamSelect.value,
      previousVersion = versionSelect.value;
    data = {
      teams: installedTeamChoices(values[0], values[1]),
      drafts: values[1],
      proposals: values[2],
      history: values[3],
      workflows: values[4],
    };
    loaded = true;
    refreshRequired = false;
    teamSelect.replaceChildren();
    option(teamSelect, "", "Kurulmuş bir takım seçin");
    for (const team of data.teams)
      option(
        teamSelect,
        team.id,
        `${team.name} · sürüm ${team.draftId} · ${taskStateLabel(team.status)}`,
      );
    if (data.teams.some((team) => team.id === previousTeam))
      teamSelect.value = previousTeam;
    versionSelect.replaceChildren();
    compareSelect.replaceChildren();
    option(compareSelect, "", "Karşılaştırma yok");
    for (const draft of data.drafts) {
      option(
        versionSelect,
        draft.action_id,
        `${draft.document.name} · kayıtlı sürüm ${draft.action_id}`,
      );
      option(
        compareSelect,
        draft.action_id,
        `${draft.document.name} · kayıtlı sürüm ${draft.action_id}`,
      );
    }
    if (
      data.drafts.some((draft) => String(draft.action_id) === previousVersion)
    )
      versionSelect.value = previousVersion;
    renderMembers();
    renderDraft();
    renderProposals();
    renderHistory();
    renderWorkflows();
  }
  async function read(work, success) {
    if (busy || disposed) return;
    busy = true;
    controls();
    const request = ++readVersion;
    try {
      await work();
      if (!disposed && request === readVersion && success)
        status.textContent = success;
    } catch (error) {
      if (!disposed) {
        refreshRequired = true;
        status.textContent = friendlyError(error);
      }
    } finally {
      if (!disposed) {
        busy = false;
        controls();
      }
    }
  }
  async function refresh() {
    return read(
      load,
      "Kayıtlar yenilendi. Hiçbir görev otomatik çalıştırılmadı.",
    );
  }
  async function mutate(work, success) {
    if (busy || disposed || !loaded || refreshRequired) return;
    await read(async () => {
      await work();
      await load();
    }, success);
  }
  async function readProposal(actionId) {
    reviewed = null;
    reviewBox.replaceChildren();
    return read(async () => {
      const value = await api(`/approvals/${actionId}`);
      if (Number(value.actionId) !== Number(actionId) || !hash(value.digest))
        throw new Error("TASK_PANEL_INVALID_RESPONSE");
      reviewed = value;
      reviewBox.append(node("h3", "İncelenen görev sürümü"));
      paragraph(reviewBox, "Görev", value.intent?.content);
      paragraph(reviewBox, "Hedef", value.intent?.target);
      paragraph(
        reviewBox,
        "Üst maliyet sınırı",
        mockCostLabel(value.intent?.amountMicros),
      );
      paragraph(reviewBox, "Durum", taskStateLabel(value.status));
      const confirmationLabel = node("label", "Bu içeriği ve hedefi okudum.");
      const confirmation = node("input", "", "tasks-review-confirm");
      confirmation.type = "checkbox";
      confirmationLabel.prepend(confirmation);
      const approve = button(
        "Bu görev sürümünü onayla",
        "tasks-review-approve",
      );
      approve.dataset.operation = "approve";
      const execute = button(
        "Onaylı görevi sahte çalıştır",
        "tasks-review-execute",
      );
      execute.dataset.operation = "execute";
      const expiry = Date.parse(value.expiresAt);
      const eligible = Number.isFinite(expiry) && expiry > Date.now();
      const synchronize = () => {
        approve.dataset.ineligible = String(
          !confirmation.checked ||
            value.status !== "pending_approval" ||
            !!value.reviewer ||
            !eligible,
        );
        execute.dataset.ineligible = String(
          !confirmation.checked ||
            value.status !== "approved" ||
            !value.reviewer ||
            !eligible,
        );
        controls();
      };
      confirmation.onchange = synchronize;
      approve.onclick = () =>
        mutate(async () => {
          if (!confirmation.checked || reviewed !== value)
            throw new Error("PERSONA_APPROVAL_STALE");
          await api(`/approvals/${actionId}`, { digest: value.digest });
        }, "İnsan onayı kaydedildi. Görev otomatik çalıştırılmadı.");
      execute.onclick = () =>
        mutate(async () => {
          if (!confirmation.checked || reviewed !== value)
            throw new Error("PERSONA_APPROVAL_STALE");
          await api(`/executions/${actionId}`, {});
        }, "Sahte çalışma tamamlandı. Gerçek sağlayıcı, yayın veya gönderim kullanılmadı.");
      if (!eligible)
        empty(
          reviewBox,
          "Bu onayın süresi dolmuş veya doğrulanamıyor; mevcut sürüm çalıştırılamaz.",
        );
      reviewBox.append(confirmationLabel, approve, execute);
      synchronize();
    });
  }
  refreshButton.onclick = refresh;
  teamSelect.onchange = () => {
    memberSelect.value = "";
    renderMembers();
  };
  teamPause.onclick = () =>
    mutate(async () => {
      const team = currentTeam();
      if (!team) throw new Error("TASK_PANEL_INVALID_SELECTION");
      await api(`/teams/${team.id}/pause`, {
        paused: team.status !== "PAUSED",
      });
    }, "Yalnız takımın sahte çalışma durumu değişti. Gerçek sağlayıcı veya erişim yetkisi açılmadı.");
  memberSelect.onchange = renderMemberInfo;
  brief.oninput = controls;
  proposeButton.onclick = () =>
    mutate(async () => {
      const member = currentMember(),
        team = currentTeam(),
        content = brief.value.trim();
      if (
        !member ||
        team?.status !== "MOCK_READY" ||
        !content ||
        content.length > 16000
      )
        throw new Error("TASK_PANEL_INVALID_SELECTION");
      await api("/proposals", {
        personaId: member.personaId,
        content,
        target: "local-preview",
      });
      brief.value = "";
    }, "Görev kaydedildi ve ayrı insan onayı bekliyor. Henüz çalıştırılmadı.");
  versionSelect.onchange = renderDraft;
  compareSelect.onchange = renderDraft;
  versionConfirm.onchange = controls;
  versionReview.onclick = () =>
    read(async () => {
      const selected = currentDraft();
      if (!selected) return;
      const fresh = await api("/team-drafts");
      const exact = fresh.find(
        (row) => Number(row.action_id) === Number(selected.action_id),
      );
      if (
        !exact ||
        exact.digest !== selected.digest ||
        canonical(exact.document) !== canonical(selected.document)
      )
        throw new Error("PERSONA_APPROVAL_STALE");
      versionReviewed = { actionId: selected.action_id, digest: exact.digest };
      for (const detail of versionPreview.querySelectorAll("details"))
        detail.open = true;
      versionConfirm.checked = false;
      status.textContent =
        "Talimatlar açıldı. İnceledikten sonra kutuyu işaretleyin; onay ve kurulum ayrı işlemlerdir.";
    });
  const verifiedVersion = () => {
    const selected = currentDraft();
    if (
      !selected ||
      !versionReviewed ||
      !versionConfirm.checked ||
      Number(selected.action_id) !== Number(versionReviewed.actionId) ||
      selected.digest !== versionReviewed.digest
    )
      throw new Error("PERSONA_APPROVAL_STALE");
    return selected;
  };
  versionApprove.onclick = () =>
    mutate(async () => {
      const selected = verifiedVersion();
      await api(`/team-drafts/${selected.action_id}/approve`, {
        digest: selected.digest,
      });
    }, "Takım sürümü onaylandı. Kurulum veya çalışma başlatılmadı.");
  versionInstall.onclick = () =>
    mutate(async () => {
      const selected = verifiedVersion();
      if (!selected.reviewer) throw new Error("PERSONA_APPROVAL_REQUIRED");
      await api(`/team-drafts/${selected.action_id}/install`, {
        digest: selected.digest,
      });
    }, "Onaylı takım duraklatılmış kuruldu. Çalışma, gerçek sağlayıcı ve yeni erişim yetkisi açılmadı.");
  const graphSelection = (event) => {
    const name =
      typeof event.detail?.name === "string"
        ? event.detail.name.slice(0, 100)
        : "Taslak üye";
    selectionNotice.textContent = `Şemada seçilen: ${name}. Bu yalnız taslak seçimidir. İsimden eşleştirme yapılmadı; kurulmuş takım ve üyeyi açıkça seçin.`;
    memberSelect.value = "";
    renderMemberInfo();
  };
  win?.addEventListener("persona-member-selected", graphSelection);
  controls();
  return {
    refresh,
    destroy() {
      disposed = true;
      readVersion++;
      win?.removeEventListener("persona-member-selected", graphSelection);
    },
  };
}
