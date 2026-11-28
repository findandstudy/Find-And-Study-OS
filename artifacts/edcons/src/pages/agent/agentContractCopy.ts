import { translateUi } from '../../lib/ui-localization';
// Shared UI catalogue; signed contracts and frozen snapshots are untouched.
export function agentContractCopy(lang: string) {
  return {
    title: translateUi(lang, 'Signed contract', 'İmzalı sözleşme'),
    signed: translateUi(lang, 'Signed', 'İmzalandı'),
    pending: translateUi(lang, 'Your signature is saved. The PDF is not ready yet. You can refresh its status; you do not need to sign again.', 'İmzanız kaydedildi. PDF henüz hazır değil. Durumu yenileyebilirsiniz; tekrar imzalamanız gerekmez.'),
    download: translateUi(lang, 'Download signed PDF', "İmzalı PDF’yi indir"),
    refresh: translateUi(lang, 'Refresh status', 'Durumu yenile'),
    downloadError: translateUi(lang, 'Could not download the PDF. Please try again.', 'PDF indirilemedi. Lütfen tekrar deneyin.'),
    approvalTitle: translateUi(lang, 'Contract signed — awaiting staff approval', 'Sözleşmeniz imzalandı; yönetici onayı bekleniyor'),
    approvalBody: translateUi(lang, "Signing is complete. Commission rates and commercial management tools become available after our team's final approval. You do not need to sign again.", 'İmza işlemi tamamlandı. Komisyon ve ticari yönetim araçları, ekibimizin son onayından sonra açılacak. Tekrar imza atmanız gerekmez.'),
  };
}
