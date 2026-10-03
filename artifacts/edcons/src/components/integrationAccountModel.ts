export type AccountChannel = "whatsapp" | "messenger" | "instagram" | "telegram" | "sms";
export type AccountScope = { kind: "channel"; provider: "direct" | "zernio"; channels: readonly AccountChannel[] } | { kind: "email" };

/** One account registry; SMTP deliberately uses its revision/maker-checker API. */
export function integrationAccountScope(key: string): AccountScope | null {
  if (key === "smtp") return { kind: "email" };
  if (key === "zernio") return { kind: "channel", provider: "zernio", channels: ["whatsapp", "instagram", "messenger", "telegram"] };
  const channels: Record<string, AccountChannel> = { whatsapp: "whatsapp", facebook_messenger: "messenger", instagram: "instagram", telegram: "telegram", sms_twilio: "sms" };
  const channel = Object.hasOwn(channels, key) ? channels[key] : undefined;
  return channel ? { kind: "channel", provider: "direct", channels: [channel] } : null;
}

export function accountListPath(scope: Extract<AccountScope, { kind: "channel" }>): string {
  const query = new URLSearchParams();
  if (scope.channels.length === 1) query.set("channel", scope.channels[0]);
  query.set("provider", scope.provider);
  return `/api/channel-accounts?${query}`;
}

export function accountWebhookPath(provider: string, channel: string): string | null {
  if (provider === "zernio") return "/api/webhooks/zernio";
  if (provider !== "direct") return null;
  if (channel === "whatsapp") return "/api/webhooks/whatsapp";
  if (channel === "messenger" || channel === "instagram") return "/api/webhooks/meta";
  return null;
}

/** A simulated/not-supported result is never a successfully verified account. */
export function accountTestState(result: { status?: string; success?: boolean; verified?: boolean; simulated?: boolean }): "verified" | "unverified" | "failed" {
  if (result.simulated || result.status === "simulated" || result.status === "not_supported") return "unverified";
  return result.status !== "failed" && result.success === true && result.verified === true ? "verified" : "failed";
}

export function canManageIntegrationAccounts(user: { role?: string; isActive?: boolean; isImpersonating?: boolean } | null | undefined): boolean {
  return user?.isActive === true && user.isImpersonating !== true && ["admin", "super_admin"].includes(user.role ?? "");
}

export function integrationAccountsCopy(lang: string) {
  const tr = lang === "tr";
  const copy = (en: string, turkish: string) => tr ? turkish : en;
  return {
    copy,
    emailHint: copy("Sender accounts use the same approved SMTP settings as Notifications. Sending only; this does not connect an email inbox or OAuth mailbox.", "Gönderici hesapları Bildirimler ile aynı onaylı SMTP ayarlarını kullanır. Yalnız e-posta gönderimi içindir; gelen kutusu veya OAuth posta hesabı bağlanmaz."),
    legacy: copy("Legacy configuration", "Eski yapılandırma"),
    anthropic: copy("Add Anthropic connection", "Anthropic bağlantısı ekle"),
    adminRequired: copy("Account management requires a non-impersonated admin session.", "Hesap yönetimi, kullanıcı taklidi olmayan bir yönetici oturumu gerektirir."),
    channel: copy("Channel", "Kanal"),
    zernioHint: copy("Uses the API key and webhook secret in Zernio's existing configuration. Enter the exact connected account ID from Zernio; no automatic provider connection is performed here.", "Zernio'nun mevcut yapılandırmasındaki API anahtarı ve webhook sırrını kullanır. Zernio'daki bağlı hesabın tam kimliğini girin; burada sağlayıcıya otomatik bağlantı kurulmaz."),
    nativeHint: copy("Configuration only — native Telegram/SMS message delivery and incoming-message webhooks are not connected. Activation and connection testing are unavailable.", "Yalnız yapılandırma — yerel Telegram/SMS mesaj gönderimi ve gelen mesaj webhook'ları bağlı değildir. Aktifleştirme ve bağlantı testi kullanılamaz."),
    configurationOnly: copy("Configuration only", "Yalnız yapılandırma"),
    inactiveHint: copy("New accounts are saved inactive. Saving does not send a message or verify credentials.", "Yeni hesaplar pasif kaydedilir. Kaydetmek mesaj göndermez veya bağlantıyı doğrulamaz."),
    immutable: copy("Channel and provider account ID cannot change after creation; existing conversations keep their routing.", "Kanal ve sağlayıcı hesap kimliği oluşturulduktan sonra değiştirilemez; mevcut konuşmaların yönlendirmesi korunur."),
    externalId: copy("Zernio account ID", "Zernio hesap kimliği"),
    webhook: copy("Webhook callback", "Webhook adresi"),
    noVerification: copy("Verification not performed", "Doğrulama yapılmadı"),
    loadError: copy("Accounts could not be loaded. Retry before editing.", "Hesaplar yüklenemedi. Düzenlemeden önce yeniden deneyin."),
    retry: copy("Retry", "Yeniden dene"),
    secretHint: copy("Leave a saved secret unchanged or empty to retain it. Secrets are not revealed.", "Kayıtlı bir sırrı korumak için değiştirmeyin veya boş bırakın. Sırlar görüntülenmez."),
    botToken: copy("Bot token", "Bot anahtarı"),
    defaultChatId: copy("Default chat ID", "Varsayılan sohbet kimliği"),
    accountSid: copy("Twilio account SID", "Twilio hesap SID"),
    authToken: copy("Auth token", "Kimlik doğrulama anahtarı"),
    fromNumber: copy("Sender number", "Gönderici numarası"),
    showSecret: copy("Show entered value", "Girilen değeri göster"),
    hideSecret: copy("Hide entered value", "Girilen değeri gizle"),
  };
}
