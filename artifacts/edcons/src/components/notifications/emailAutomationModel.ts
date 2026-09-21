export const EMAIL_AUTOMATION_PATH = "/admin/settings?tab=notifications#notification-email";
export function canManageNotificationRules(user: { role: string; isActive: boolean; isImpersonating?: boolean } | null | undefined, authorityConfirmed: boolean): boolean {
  return authorityConfirmed === true && user?.isActive === true && user.isImpersonating !== true && ["admin", "super_admin"].includes(user.role);
}
export type EmailSender = { id: number; displayName: string; fromEmail: string; fromName: string; replyTo?: string | null; config: { host: string; port: number; username: string; passwordConfigured: boolean }; isActive: boolean; verified: boolean; revision: number; createdById: number; lastChangedById: number };
export type EmailTemplateVersion = { id: number; templateId: number; version: number; status: string; subject: string; content: string; language: string; variables: string[]; createdById: number; approvedById?: number | null; createdAt: string };
export type EmailTemplate = { id: number; name: string; category: string; channel: string; language: string; isActive: boolean; versions: EmailTemplateVersion[] };
export type EmailHistoryItem = { id: number; kind?: "stage" | "system"; applicationId?: number; stageKey?: string; status: string; errorCode?: string | null; createdAt: string; templateVersionId: number; senderAccountId: number; queueStatus?: string | null };
export type EmailCapabilities = { enabled: boolean; verificationAllowed: boolean; variables: string[]; stageVariables: string[]; languages: string[]; categories: string[]; canManage: boolean };
export type ApprovedEmailOption = { id: number; label: string; language: string };

export function approvedEmailOptions(templates: EmailTemplate[], allowedVariables?: readonly string[]): ApprovedEmailOption[] {
  return templates.filter(template => template.isActive && ["email", "all"].includes(template.channel)).flatMap(template => template.versions
    .filter(version => version.status.toLowerCase() === "approved" && (!allowedVariables || version.variables.every(v => allowedVariables.includes(v))))
    .map(version => ({ id: version.id, label: `${template.name} · ${version.language.toUpperCase()} · v${version.version}`, language: version.language })));
}
export function verifiedEmailSenders(senders: EmailSender[]): EmailSender[] { return senders.filter(sender => sender.isActive === true && sender.verified === true); }
export function emailTemplateVariables(subject: string, content: string): string[] {
  return [...new Set([...`${subject}\n${content}`.matchAll(/\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g)].map(match => match[1]))].sort();
}
export function canApproveEmail(version: EmailTemplateVersion, userId?: number): boolean {
  return version.status.toLowerCase() === "review" && Number.isSafeInteger(userId) && Number.isSafeInteger(version.createdById) && userId !== version.createdById;
}
export function canVerifyEmailSender(sender: EmailSender, userId?: number): boolean {
  return Number.isSafeInteger(userId) && Number.isSafeInteger(sender.lastChangedById) && userId !== sender.lastChangedById;
}
export function safeEmailPreview(html: string): string {
  // No network, script, form, framing or popup permissions; the iframe also has an empty sandbox.
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'"><meta name="referrer" content="no-referrer"></head><body>${html.slice(0, 200_000)}</body></html>`;
}
export function emailStageValid(value: { enabled: boolean; templateVersionId: number | null; senderAccountId: number | null; originTypes: string[] } | null | undefined): boolean {
  if (!value?.enabled) return true;
  return Number.isSafeInteger(value.templateVersionId) && Number(value.templateVersionId) > 0 && Number.isSafeInteger(value.senderAccountId) && Number(value.senderAccountId) > 0 && Array.isArray(value.originTypes) && value.originTypes.length > 0 && value.originTypes.every(origin => ["direct", "agent", "sub_agent"].includes(origin));
}
export function emailStatusLabel(status: string, lang: string): string {
  const copy = (en: string, tr: string) => lang === "tr" ? tr : en;
  const labels: Record<string, string> = {
    draft: copy("Draft", "Taslak"), review: copy("In review", "İncelemede"), approved: copy("Approved", "Onaylı"), retired: copy("Retired", "Kullanımdan kaldırıldı"),
    pending: copy("Pending", "Bekliyor"), queued: copy("Queued", "Kuyrukta"), enqueued: copy("Queued for sending", "Gönderim kuyruğuna alındı"), processing: copy("Processing", "İşleniyor"),
    sent: copy("SMTP accepted", "SMTP kabul etti"), failed: copy("Failed", "Başarısız"), skipped: copy("Skipped", "Atlandı"), blocked: copy("Blocked", "Engellendi"),
    uncertain: copy("Delivery uncertain", "Gönderim belirsiz"), unknown: copy("Delivery outcome unknown", "Gönderim sonucu bilinmiyor"),
  };
  return labels[status] ?? status;
}
export function emailAutomationCopy(lang: string) {
  const copy = (en: string, tr: string) => lang === "tr" ? tr : en;
  return { copy,
    title: copy("Email automation", "E-posta otomasyonu"), templates: copy("Email templates", "E-posta şablonları"), senders: copy("Sender email addresses", "Gönderici e-posta adresleri"), history: copy("Delivery history", "Gönderim geçmişi"),
    intro: copy("One shared library for application-stage emails and reusable system templates. Saving a template does not send an email or create an event trigger.", "Başvuru aşaması e-postaları ve sistemde kullanılabilir şablonlar için ortak kütüphane. Şablon kaydetmek e-posta göndermez veya yeni bir olay tetikleyicisi oluşturmaz."),
    disabled: copy("Application-stage email automation is disabled in this environment. Configuration can be prepared; historical stages are not replayed. Existing system notification delivery uses its own controls.", "Bu ortamda başvuru aşaması e-posta otomasyonu kapalı. Ayarlar hazırlanabilir; geçmiş aşamalar tekrar gönderilmez. Mevcut sistem bildirimleri kendi gönderim kontrollerini kullanır."),
    enabled: copy("Application-stage email automation is enabled. Stage rules still require an approved version and verified active sender. Existing system notifications use their own delivery controls.", "Başvuru aşaması e-posta otomasyonu açık. Aşama kuralları onaylı sürüm ve doğrulanmış aktif gönderici gerektirir. Mevcut sistem bildirimleri kendi gönderim kontrollerini kullanır."),
    loadError: copy("This section could not be loaded. Retry without changing existing configuration.", "Bu bölüm yüklenemedi. Mevcut ayarları değiştirmeden yeniden deneyin."),
    error: copy("The action could not be completed. Nothing was sent. Refresh and check permissions, verification and review status.", "İşlem tamamlanamadı. E-posta gönderilmedi. Yenileyip yetki, doğrulama ve inceleme durumunu kontrol edin."),
    loading: copy("Loading…", "Yükleniyor…"), refresh: copy("Refresh", "Yenile"), empty: copy("No records yet.", "Henüz kayıt yok."),
    newTemplate: copy("New email template", "Yeni e-posta şablonu"), newVersion: copy("Create new draft version", "Yeni taslak sürüm oluştur"), newSender: copy("Add sender", "Gönderici ekle"), edit: copy("Edit", "Düzenle"),
    name: copy("Name", "Ad"), category: copy("Category", "Kategori"), language: copy("Content language", "İçerik dili"), subject: copy("Subject", "Konu"), content: copy("Email body (text or HTML)", "E-posta gövdesi (metin veya HTML)"),
    variables: copy("Detected variables", "Algılanan değişkenler"), variablesHint: copy("Use {{variableName}}. Only supported variables can be submitted for approval.", "{{variableName}} kullanın. Yalnızca desteklenen değişkenler onaya gönderilebilir."),
    saveDraft: copy("Save draft", "Taslağı kaydet"), save: copy("Save", "Kaydet"), cancel: copy("Cancel", "Vazgeç"), preview: copy("Preview", "Önizleme"),
    previewNote: copy("Preview only; scripts and external resources are blocked. No email is sent.", "Yalnızca önizleme; betikler ve dış kaynaklar engellenir. E-posta gönderilmez."),
    submit: copy("Submit for review", "İncelemeye gönder"), approve: copy("Approve version", "Sürümü onayla"), retire: copy("Retire version", "Sürümü kullanımdan kaldır"),
    makerChecker: copy("Approval requires a different reviewer. Editing creates a new draft; approved content is not overwritten.", "Onay için farklı bir incelemeci gerekir. Düzenleme yeni taslak oluşturur; onaylı içerik değiştirilmez."),
    verify: copy("Verify SMTP connection", "SMTP bağlantısını doğrula"), verifyNote: copy("A different administrator must verify. This connects to the SMTP server to verify credentials; it sends no email and does not prove domain ownership or inbox delivery. Environment policy may disable verification.", "Farklı bir yönetici doğrulamalıdır. SMTP sunucusuna bağlanarak kimlik bilgilerini doğrular; e-posta göndermez, alan adı sahipliğini veya gelen kutusuna teslimi kanıtlamaz. Ortam politikası doğrulamayı kapatabilir."),
    verifySuccess: copy("SMTP verification completed. Refresh to see eligibility.", "SMTP doğrulaması tamamlandı. Uygunluğu görmek için yenileyin."),
    confirmation: copy("Confirm action", "İşlemi onayla"), continue: copy("Continue", "Devam et"),
    approvalNote: copy("Approve this exact version for future configured sends. No email is sent now.", "Bu sürümü gelecekteki yapılandırılmış gönderimler için onaylayın. Şimdi e-posta gönderilmez."),
    retireNote: copy("This version will no longer be eligible for new stage configuration or pending sends. Review stages that reference it.", "Bu sürüm yeni aşama ayarları ve bekleyen gönderimler için kullanılamaz. Bu sürüme bağlı aşamaları inceleyin."),
    verified: copy("Verified", "Doğrulandı"), notVerified: copy("Not verified", "Doğrulanmadı"), active: copy("Active", "Aktif"), inactive: copy("Inactive", "Pasif"),
    host: copy("SMTP host", "SMTP sunucusu"), port: copy("SMTP port", "SMTP portu"), username: copy("SMTP username", "SMTP kullanıcı adı"), password: copy("SMTP password", "SMTP parolası"),
    passwordHint: copy("Leave blank to keep an existing password. Passwords are never returned by the API.", "Mevcut parolayı korumak için boş bırakın. Parolalar API tarafından geri gösterilmez."),
    senderHint: copy("New or edited senders stay inactive until a different administrator verifies them. Changes invalidate pinned rules: verify and reselect the sender in affected rules. Verification activates the sender.", "Yeni veya düzenlenen gönderici, farklı bir yönetici doğrulayana kadar pasif kalır. Değişiklikler bağlı kuralları geçersiz kılar: doğruladıktan sonra ilgili kurallarda göndericiyi yeniden seçin. Doğrulama göndericiyi etkinleştirir."),
    fromEmail: copy("From email", "Gönderici e-posta"), fromName: copy("From name", "Gönderici adı"), replyTo: copy("Reply-to (optional)", "Yanıt adresi (isteğe bağlı)"),
    stageTitle: copy("Automatic email", "Otomatik e-posta"), stageEnabled: copy("Send an email when this application enters the stage", "Başvuru bu aşamaya girdiğinde e-posta gönder"),
    version: copy("Approved template version", "Onaylı şablon sürümü"), sender: copy("Verified active sender", "Doğrulanmış aktif gönderici"), select: copy("Select…", "Seçin…"),
    origin: copy("Send for record origins", "Gönderim yapılacak kayıt kaynakları"), originHint: copy("Direct is the default. Include agency and sub-agency records only by selecting them.", "Varsayılan Direct'tir. Acente ve alt acente kayıtları yalnızca seçilirse dahil edilir."),
    stageNote: copy("Recipient: the application's student, only at an email matching their verified active account. Missing or unverified email is skipped with a reason in history, never redirected to an agency. One email per application and stage, independently of WhatsApp. No backfill or retroactive sends. Select the exact approved language version.", "Alıcı: başvurunun öğrencisi; e-posta, öğrencinin doğrulanmış aktif hesabıyla eşleşmelidir. Eksik veya doğrulanmamış adres gerekçesiyle geçmişte atlandı olarak görünür; acenteye yönlendirilmez. WhatsApp'tan bağımsız olarak başvuru ve aşama başına bir e-posta. Geçmiş kayıtlara geriye dönük gönderim yapılmaz. Onaylı dil sürümünü açıkça seçin."),
    required: copy("Select an approved version, a verified active sender and at least one origin before saving.", "Kaydetmeden önce onaylı sürüm, doğrulanmış aktif gönderici ve en az bir kayıt kaynağı seçin."),
    unavailable: copy("Previously selected option is no longer eligible. Select another option or disable this automation.", "Önceki seçim artık kullanıma uygun değil. Başka bir seçenek seçin veya bu otomasyonu kapatın."),
    historyNote: copy("Recent shared-library email records only. Status 'sent' means accepted by the SMTP server, not confirmed inbox delivery. Legacy email, recipient addresses and message contents are not shown.", "Yalnızca ortak kütüphane e-postalarının son kayıtları. 'Gönderildi' durumu SMTP sunucusunun kabulünü belirtir; gelen kutusuna teslim edildiğinin kanıtı değildir. Eski e-postalar, alıcı adresleri ve mesaj içerikleri gösterilmez."),
    status: copy("Status", "Durum"), application: copy("Application", "Başvuru"), stage: copy("Stage", "Aşama"), date: copy("Created", "Oluşturulma"), reason: copy("Reason code", "Neden kodu"),
    libraryLink: copy("Manage automatic email templates in Notifications", "Otomatik e-posta şablonlarını Bildirimler'de yönet"), fallback: copy("New automation controls use English where a local translation is unavailable.", ""),
  };
}
