// Local copy for the agency signature/delivery state; untranslated locales use English.
export function agentContractCopy(lang: string) {
  return lang === "tr" ? {
    title: "İmzalı sözleşme", signed: "İmzalandı", pending: "İmzanız kaydedildi. PDF henüz hazır değil. Durumu yenileyebilirsiniz; tekrar imzalamanız gerekmez.",
    download: "İmzalı PDF'yi indir", refresh: "Durumu yenile", downloadError: "PDF indirilemedi. Lütfen tekrar deneyin.",
    approvalTitle: "Sözleşmeniz imzalandı; yönetici onayı bekleniyor",
    approvalBody: "İmza işlemi tamamlandı. Komisyon ve ticari yönetim araçları, ekibimizin son onayından sonra açılacak. Tekrar imza atmanız gerekmez.",
  } : {
    title: "Signed contract", signed: "Signed", pending: "Your signature is saved. The PDF is not ready yet. You can refresh its status; you do not need to sign again.",
    download: "Download signed PDF", refresh: "Refresh status", downloadError: "Could not download the PDF. Please try again.",
    approvalTitle: "Contract signed — awaiting staff approval",
    approvalBody: "Signing is complete. Commission rates and commercial management tools become available after our team's final approval. You do not need to sign again.",
  };
}
