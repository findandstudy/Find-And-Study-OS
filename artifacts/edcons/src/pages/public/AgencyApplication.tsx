import { useEffect, useMemo, useState, type ReactNode } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/use-i18n";
import { LANGUAGE_META, type Language } from "@/lib/i18n";
import { useCitySearch, useCountrySearch } from "@/hooks/use-countries";
import { isPhoneFieldValid } from "@/components/ui/phone-field";
import { PhoneInput } from "@/components/ui/phone-input";
import { CountryFlag, countryCodeFromEmoji } from "@/components/CountryFlag";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { MultiSelectFilter } from "@/components/ui/multi-select-filter";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, ArrowLeft, ArrowRight, Building2, CheckCircle2, FileCheck2, FileSignature, Loader2, MailCheck, RefreshCw, ShieldCheck, Upload } from "lucide-react";

type MatrixRow = { templateId: number; entityType: string; language: string; title: string; version: number };
type UploadDocument = { fileKey: string; name: string; contentType: "application/pdf" | "image/jpeg" | "image/png"; size: number };
type Documents = { logo?: UploadDocument | null; representativeId?: UploadDocument | null; businessRegistration?: UploadDocument | null };
type PublicApplication = {
  referenceCode: string; status: string; firstName: string; lastName: string; email: string; phone?: string | null;
  entityType: string; preferredLanguage: string; companyName?: string | null; businessName?: string | null;
  taxNumber?: string | null; country?: string | null; state?: string | null; city?: string | null; address?: string | null;
  website?: string | null; estimatedStudents?: number | null; operatingCountries?: unknown; recruitmentMarkets?: unknown;
  documents?: Documents; canStartSigning?: boolean; changeRequestMessage?: string | null;
};

type Copy = {
  badge: string; title: string; subtitle: string; loading: string; unavailable: string; steps: [string, string, string, string];
  language: string; entityType: string; company: string; individual: string; companyHint: string; individualHint: string;
  companyName: string; displayName: string; taxNumber: string; country: string; city: string; state: string;
  firstName: string; lastName: string; email: string; phone: string; website: string; address: string;
  verifyEmail: string; code: string; confirmCode: string; verified: string; verificationSent: string; contactTitle: string;
  documentsTitle: string; logo: string; representativeId: string; businessRegistration: string; optional: string; required: string;
  uploadHelp: string; maxFile: string; estimatedStudents: string; operatingCountries: string; recruitmentMarkets: string;
  selectCountries: string; searchCountries: string; noCountries: string; clearAll: string; selected: string;
  reviewTitle: string; contract: string; automaticContract: string; consent: string; continue: string; back: string; submit: string;
  submitting: string; applicationSaved: string; status: string; reference: string; pending: string; changesRequested: string;
  updateApplication: string; rejected: string; approved: string; awaitingSignature: string; signContract: string; signing: string;
  startNew: string; errorRequired: string; errorEmail: string; errorVerify: string; errorPhone: string; errorCompany: string;
  errorDocuments: string; errorConsent: string; errorVerificationDelivery: string; errorWebsite: string;
  errorInvalidFields: string; security: string; securityText: string;
};

const EN: Copy = {
  badge: "Agency partnership", title: "Become a Find And Study partner",
  subtitle: "Apply in a few steps. We review your verified information first and send the appropriate contract to your portal afterwards.",
  loading: "Loading application options…", unavailable: "No matching published agency contract is currently available.",
  steps: ["Business profile", "Contact & verification", "Documents", "Review"], language: "Application language",
  entityType: "Applicant type", company: "Company", individual: "Individual", companyHint: "Registered agency or organization",
  individualHint: "Independent education consultant", companyName: "Legal company name", displayName: "Professional display name",
  taxNumber: "Tax / registration number", country: "Country", city: "City", state: "State / region", firstName: "First name",
  lastName: "Last name", email: "Business email", phone: "Phone", website: "Website", address: "Registered address",
  verifyEmail: "Send verification code", code: "6-digit verification code", confirmCode: "Verify code", verified: "Email verified",
  verificationSent: "A verification code was sent. It expires in 15 minutes.", contactTitle: "Contact and verification",
  documentsTitle: "Identity and registration documents", logo: "Logo for agent portal", representativeId: "Representative ID proof",
  businessRegistration: "Business registration certificate", optional: "Optional", required: "Required",
  uploadHelp: "PDF, JPG, JPEG or PNG", maxFile: "Maximum 10 MB per file", estimatedStudents: "Estimated students per year",
  operatingCountries: "Countries where you operate", recruitmentMarkets: "Student recruitment markets",
  selectCountries: "Select countries", searchCountries: "Search countries…", noCountries: "No countries found",
  clearAll: "Clear all", selected: "selected", reviewTitle: "Review your application", contract: "Contract template",
  automaticContract: "Selected automatically from applicant type and language. Staff can change it before sending.",
  consent: "I confirm that the information is correct and consent to its use for reviewing this partnership application and preparing the contract.",
  continue: "Continue", back: "Back", submit: "Submit application", submitting: "Submitting…", applicationSaved: "Application received",
  status: "Status", reference: "Reference", pending: "Your verified application is waiting for staff review. You do not need to sign anything yet.",
  changesRequested: "Changes requested", updateApplication: "Submit updated application", rejected: "This application was not approved.",
  approved: "Your partnership has been approved. Your agency code was generated automatically.",
  awaitingSignature: "Your contract is ready. Review and sign it in the secure signing portal.", signContract: "Review & sign contract",
  signing: "Opening contract…", startNew: "Start another application", errorRequired: "Complete all required fields.",
  errorEmail: "Enter a valid business email.", errorVerify: "Verify the business email before continuing.",
  errorPhone: "Enter a valid phone number with country code.", errorCompany: "Company name and registration certificate are required for companies.",
  errorDocuments: "Upload the required documents.", errorConsent: "Accept the declaration before submitting.",
  errorVerificationDelivery: "The verification email could not be delivered. Please try again shortly.",
  errorWebsite: "Enter a valid website address.", errorInvalidFields: "Please review these fields",
  security: "Review before signing", securityText: "Submitting does not create an agent account. Staff review the application, may change the contract template, and invite you to sign. The system creates a unique agency code only after final approval.",
};

const COPY: Partial<Record<Language, Partial<Copy>>> = {
  tr: {
    badge: "Acente ortaklığı", title: "Find And Study iş ortağı olun",
    subtitle: "Başvurunuzu birkaç adımda tamamlayın. Doğrulanmış bilgilerinizi önce inceler, uygun sözleşmeyi daha sonra portalınıza göndeririz.",
    loading: "Başvuru seçenekleri yükleniyor…", unavailable: "Şu anda eşleşen yayınlanmış acente sözleşmesi bulunmuyor.",
    steps: ["İşletme profili", "İletişim ve doğrulama", "Belgeler", "Kontrol"], language: "Başvuru dili", entityType: "Başvuru tipi",
    company: "Şirket", individual: "Bireysel", companyHint: "Kayıtlı acente veya kuruluş", individualHint: "Bağımsız eğitim danışmanı",
    companyName: "Yasal şirket unvanı", displayName: "Profesyonel görünen ad", taxNumber: "Vergi / sicil numarası",
    country: "Ülke", city: "Şehir", state: "Eyalet / bölge", firstName: "Ad", lastName: "Soyad", email: "Kurumsal e-posta",
    phone: "Telefon", website: "Web sitesi", address: "Kayıtlı adres", verifyEmail: "Doğrulama kodu gönder", code: "6 haneli doğrulama kodu",
    confirmCode: "Kodu doğrula", verified: "E-posta doğrulandı", verificationSent: "Doğrulama kodu gönderildi. Kod 15 dakika geçerlidir.",
    contactTitle: "İletişim ve doğrulama", documentsTitle: "Kimlik ve kayıt belgeleri", logo: "Acente paneli logosu",
    representativeId: "Yetkili kimlik belgesi", businessRegistration: "Şirket kayıt belgesi", optional: "İsteğe bağlı", required: "Zorunlu",
    uploadHelp: "PDF, JPG, JPEG veya PNG", maxFile: "Her dosya en fazla 10 MB", estimatedStudents: "Yıllık tahmini öğrenci",
    operatingCountries: "Faaliyet gösterilen ülkeler", recruitmentMarkets: "Öğrenci sağlanan pazarlar",
    selectCountries: "Ülke seçin", searchCountries: "Ülke ara…", noCountries: "Ülke bulunamadı", clearAll: "Tümünü temizle", selected: "seçildi",
    reviewTitle: "Başvurunuzu kontrol edin", contract: "Sözleşme şablonu", automaticContract: "Başvuru tipi ve dile göre otomatik seçilir. Personel göndermeden önce değiştirebilir.",
    consent: "Bilgilerin doğru olduğunu ve ortaklık başvurusunun incelenmesi ile sözleşmenin hazırlanması amacıyla kullanılmasını kabul ediyorum.",
    continue: "Devam", back: "Geri", submit: "Başvuruyu gönder", submitting: "Gönderiliyor…", applicationSaved: "Başvuru alındı",
    status: "Durum", reference: "Referans", pending: "Doğrulanmış başvurunuz personel incelemesini bekliyor. Şu anda sözleşme imzalamanız gerekmiyor.",
    changesRequested: "Düzeltme istendi", updateApplication: "Güncel başvuruyu gönder", rejected: "Bu başvuru onaylanmadı.",
    approved: "Ortaklık başvurunuz onaylandı. Acente kodunuz sistem tarafından otomatik üretildi.",
    awaitingSignature: "Sözleşmeniz hazır. Güvenli imza portalında inceleyip imzalayın.", signContract: "Sözleşmeyi incele ve imzala",
    signing: "Sözleşme açılıyor…", startNew: "Yeni başvuru başlat", errorRequired: "Zorunlu alanları doldurun.",
    errorEmail: "Geçerli bir kurumsal e-posta girin.", errorVerify: "Devam etmeden önce kurumsal e-postayı doğrulayın.",
    errorPhone: "Ülke koduyla birlikte geçerli bir telefon numarası girin.", errorCompany: "Şirket başvurularında şirket unvanı ve kayıt belgesi zorunludur.",
    errorDocuments: "Zorunlu belgeleri yükleyin.", errorConsent: "Göndermeden önce beyanı kabul edin.",
    errorVerificationDelivery: "Doğrulama e-postası gönderilemedi. Lütfen kısa süre sonra tekrar deneyin.",
    errorWebsite: "Geçerli bir web sitesi adresi girin.", errorInvalidFields: "Lütfen şu alanları kontrol edin", security: "İmzadan önce inceleme",
    securityText: "Başvuruyu göndermek acente hesabı oluşturmaz. Personel başvuruyu inceler, sözleşme şablonunu değiştirebilir ve sizi imzaya davet eder. Benzersiz acente kodu yalnızca son onaydan sonra sistem tarafından oluşturulur.",
  },
  ar: { title: "كن شريكًا لـ Find And Study", steps: ["بيانات العمل", "الاتصال والتحقق", "المستندات", "المراجعة"], continue: "متابعة", back: "رجوع", submit: "إرسال الطلب", language: "لغة الطلب", entityType: "نوع مقدم الطلب", company: "شركة", individual: "فرد", country: "الدولة", city: "المدينة", firstName: "الاسم", lastName: "اسم العائلة", email: "البريد الإلكتروني للعمل", phone: "الهاتف", verifyEmail: "إرسال رمز التحقق", confirmCode: "تحقق" },
  fr: { title: "Devenez partenaire de Find And Study", steps: ["Profil professionnel", "Contact et vérification", "Documents", "Vérification"], continue: "Continuer", back: "Retour", submit: "Envoyer la demande", language: "Langue de la demande", entityType: "Type de candidat", company: "Société", individual: "Individuel", country: "Pays", city: "Ville", firstName: "Prénom", lastName: "Nom", email: "E-mail professionnel", phone: "Téléphone" },
  ru: { title: "Станьте партнёром Find And Study", steps: ["Профиль", "Контакты и проверка", "Документы", "Проверка"], continue: "Продолжить", back: "Назад", submit: "Отправить заявку", company: "Компания", individual: "Частное лицо", country: "Страна", city: "Город", firstName: "Имя", lastName: "Фамилия", email: "Рабочая почта", phone: "Телефон" },
  es: { title: "Conviértase en socio de Find And Study", steps: ["Perfil comercial", "Contacto y verificación", "Documentos", "Revisión"], continue: "Continuar", back: "Atrás", submit: "Enviar solicitud", company: "Empresa", individual: "Individual", country: "País", city: "Ciudad", firstName: "Nombre", lastName: "Apellido", email: "Correo empresarial", phone: "Teléfono" },
  fa: { title: "همکار Find And Study شوید", steps: ["پروفایل کاری", "تماس و تأیید", "مدارک", "بازبینی"], continue: "ادامه", back: "بازگشت", submit: "ارسال درخواست", country: "کشور", city: "شهر", firstName: "نام", lastName: "نام خانوادگی", email: "ایمیل کاری", phone: "تلفن" },
  zh: { title: "成为 Find And Study 合作伙伴", steps: ["业务资料", "联系与验证", "文件", "审核"], continue: "继续", back: "返回", submit: "提交申请", country: "国家", city: "城市", firstName: "名字", lastName: "姓氏", email: "商务邮箱", phone: "电话" },
  hi: { title: "Find And Study भागीदार बनें", steps: ["व्यवसाय प्रोफ़ाइल", "संपर्क और सत्यापन", "दस्तावेज़", "समीक्षा"], continue: "जारी रखें", back: "वापस", submit: "आवेदन जमा करें", country: "देश", city: "शहर", firstName: "पहला नाम", lastName: "अंतिम नाम", email: "व्यावसायिक ईमेल", phone: "फ़ोन" },
  id: { title: "Jadilah mitra Find And Study", steps: ["Profil bisnis", "Kontak & verifikasi", "Dokumen", "Tinjau"], continue: "Lanjutkan", back: "Kembali", submit: "Kirim aplikasi", country: "Negara", city: "Kota", firstName: "Nama depan", lastName: "Nama belakang", email: "Email bisnis", phone: "Telepon" },
};

const EMPTY = { firstName: "", lastName: "", email: "", phone: "", entityType: "", preferredLanguage: "", companyName: "", businessName: "", taxNumber: "", country: "", state: "", city: "", address: "", website: "", estimatedStudents: "", operatingCountries: "", recruitmentMarkets: "", consentAccepted: false };
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const normalize = (value: string) => value.trim().toLowerCase();
const arrayText = (value: unknown) => Array.isArray(value) ? value.filter((item) => typeof item === "string").join(", ") : "";
const stringList = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);
function normalizeWebsite(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
function isValidWebsite(value: string) {
  if (!value.trim()) return true;
  try {
    const url = new URL(normalizeWebsite(value));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
function languageMeta(value: string) {
  const key = normalize(value);
  return Object.values(LANGUAGE_META).find((item) => item.code === key || normalize(item.name) === key || normalize(item.nativeName) === key);
}
function optionLabel(value: string) {
  const meta = languageMeta(value);
  return meta ? meta.nativeName : value.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}
function LanguageOption({ value }: { value: string }) {
  const meta = languageMeta(value);
  const countryCode = meta?.flag ? countryCodeFromEmoji(meta.flag) : null;
  return <span className="inline-flex items-center gap-2">{countryCode ? <CountryFlag code={countryCode} size="sm" alt="" /> : null}<span>{optionLabel(value)}</span></span>;
}

export default function AgencyApplication() {
  const { lang, isRTL } = useI18n();
  const copy = useMemo<Copy>(() => ({ ...EN, ...(COPY[lang] || {}) }), [lang]);
  const { data: countries = [] } = useCountrySearch("");
  const [matrix, setMatrix] = useState<MatrixRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(EMPTY);
  const selectedCountry = countries.find((country) => normalize(country.name) === normalize(form.country));
  const { data: cities = [], isLoading: citiesLoading } = useCitySearch(selectedCountry?.id);
  const [documents, setDocuments] = useState<Documents>({});
  const [emailCode, setEmailCode] = useState("");
  const [emailToken, setEmailToken] = useState("");
  const [verificationSent, setVerificationSent] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [signing, setSigning] = useState(false);
  const [existing, setExisting] = useState<PublicApplication | null>(null);
  const [accessToken, setAccessToken] = useState("");

  useEffect(() => {
    const queryToken = new URLSearchParams(window.location.search).get("application") || "";
    const fragmentToken = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("application") || "";
    const legacyStoredToken = localStorage.getItem("fas_agency_application_token") || "";
    const token = fragmentToken || queryToken || sessionStorage.getItem("fas_agency_application_token") || legacyStoredToken;
    if (token) sessionStorage.setItem("fas_agency_application_token", token);
    if (legacyStoredToken) localStorage.removeItem("fas_agency_application_token");
    // Remove secrets from browser history immediately. Query support remains
    // only to consume legacy email links issued before fragment links existed.
    if (fragmentToken || queryToken) window.history.replaceState(null, "", `/${lang}/agency/apply`);
    setAccessToken(token);
    Promise.all([
      customFetch<{ data: { matrix: MatrixRow[] } }>("/api/public/agent-applications/options"),
      token ? customFetch<{ data: { application: PublicApplication } }>(`/api/public/agent-applications/${encodeURIComponent(token)}`).catch(() => null) : Promise.resolve(null),
    ]).then(([options, status]) => {
      const rows = options.data.matrix || [];
      setMatrix(rows);
      const application = status?.data.application;
      if (application) {
        setExisting(application);
        if (application.status === "changes_requested") {
          setForm({ firstName: application.firstName || "", lastName: application.lastName || "", email: application.email || "", phone: application.phone || "", entityType: application.entityType || "", preferredLanguage: application.preferredLanguage || "", companyName: application.companyName || "", businessName: application.businessName || "", taxNumber: application.taxNumber || "", country: application.country || "", state: application.state || "", city: application.city || "", address: application.address || "", website: application.website || "", estimatedStudents: application.estimatedStudents == null ? "" : String(application.estimatedStudents), operatingCountries: arrayText(application.operatingCountries), recruitmentMarkets: arrayText(application.recruitmentMarkets), consentAccepted: false });
          setDocuments(application.documents || {});
        }
      } else if (rows.length) {
        const preferred = rows.find((row) => normalize(row.language) === normalize(lang)) || rows[0];
        setForm((current) => ({ ...current, entityType: preferred.entityType, preferredLanguage: preferred.language }));
      }
    }).catch((cause: any) => setError(cause?.data?.error || cause?.message || EN.unavailable)).finally(() => setLoading(false));
  }, []);

  const entityTypes = useMemo(() => [...new Set(matrix.map((row) => row.entityType))], [matrix]);
  const languages = useMemo(() => [...new Set(matrix.filter((row) => normalize(row.entityType) === normalize(form.entityType)).map((row) => row.language))], [matrix, form.entityType]);
  const selectedTemplate = matrix.find((row) => normalize(row.entityType) === normalize(form.entityType) && normalize(row.language) === normalize(form.preferredLanguage));
  const cityOptions = useMemo(() => cities.map((city) => city.name), [cities]);
  const countryOptions = useMemo(
    () => countries.map((country) => ({
      value: country.name,
      label: country.name,
      icon: <CountryFlag code={country.code} size="sm" alt="" />,
    })),
    [countries],
  );
  const isCompany = normalize(form.entityType) === "company";

  function setField(name: keyof typeof EMPTY, value: string | boolean) { setForm((current) => ({ ...current, [name]: value })); setError(""); }
  function selectEntity(value: string) {
    const rows = matrix.filter((row) => normalize(row.entityType) === normalize(value));
    const preferred = rows.find((row) => normalize(row.language) === normalize(form.preferredLanguage)) || rows[0];
    setForm((current) => ({ ...current, entityType: value, preferredLanguage: preferred?.language || "" }));
    if (normalize(value) === "individual") setDocuments((current) => ({ ...current, businessRegistration: null }));
  }
  function changeEmail(value: string) { setForm((current) => ({ ...current, email: value })); setEmailToken(""); setEmailCode(""); setVerificationSent(false); setError(""); }

  async function requestVerification() {
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) { setError(copy.errorEmail); return; }
    setVerifying(true); setError("");
    try {
      const response = await customFetch<{ data: { dispatched: boolean; developmentCode?: string } }>("/api/public/agent-applications/email-verification/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: form.email, firstName: form.firstName }) });
      if (!response.data.dispatched && !response.data.developmentCode) throw new Error(copy.errorVerificationDelivery);
      setVerificationSent(true); if (response.data.developmentCode) setEmailCode(response.data.developmentCode);
    } catch (cause: any) { setError(cause?.data?.error || cause?.message || "Verification code could not be sent"); }
    finally { setVerifying(false); }
  }
  async function confirmVerification() {
    setVerifying(true); setError("");
    try {
      const response = await customFetch<{ data: { verificationToken: string } }>("/api/public/agent-applications/email-verification/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: form.email, code: emailCode }) });
      setEmailToken(response.data.verificationToken);
    } catch (cause: any) { setError(cause?.data?.error || cause?.message || "Email could not be verified"); }
    finally { setVerifying(false); }
  }
  async function uploadDocument(kind: "logo" | "representativeId" | "businessRegistration", file: File) {
    if (!emailToken) { setError(copy.errorVerify); return; }
    if (!ALLOWED_TYPES.includes(file.type) || file.size <= 0 || file.size > MAX_FILE_SIZE) { setError(copy.maxFile); return; }
    setUploading(kind); setError("");
    try {
      const apiKind = kind === "representativeId" ? "representative_id" : kind === "businessRegistration" ? "business_registration" : "logo";
      const response = await customFetch<{ data: { uploadURL: string; objectPath: string; uploadTicket?: string } }>("/api/public/agent-applications/uploads/request-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: form.email, emailVerificationToken: emailToken, documentKind: apiKind, name: file.name, size: file.size, contentType: file.type }) });
      const localUpload = response.data.uploadURL.startsWith("/");
      const uploadResponse = await fetch(response.data.uploadURL, { method: "PUT", body: file, headers: localUpload ? { "Content-Type": file.type, "X-File-Name": file.name, "X-Upload-Ticket": response.data.uploadTicket || "" } : { "Content-Type": file.type } });
      if (!uploadResponse.ok) throw new Error(`Upload failed (${uploadResponse.status})`);
      setDocuments((current) => ({ ...current, [kind]: { fileKey: response.data.objectPath, name: file.name, contentType: file.type as UploadDocument["contentType"], size: file.size } }));
    } catch (cause: any) { setError(cause?.data?.error || cause?.message || "Document could not be uploaded"); }
    finally { setUploading(null); }
  }
  function validateStep(current: number) {
    if (current === 1) {
      if (!form.entityType || !form.preferredLanguage || !form.businessName.trim() || !form.country || !form.city) { setError(copy.errorRequired); return false; }
      if (isCompany && !form.companyName.trim()) { setError(copy.errorCompany); return false; }
    }
    if (current === 2) {
      if (!form.firstName.trim() || !form.lastName.trim() || !form.email.trim() || !form.phone || !form.address.trim()) { setError(copy.errorRequired); return false; }
      if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) { setError(copy.errorEmail); return false; }
      if (!emailToken) { setError(copy.errorVerify); return false; }
      if (!isPhoneFieldValid(form.phone, true)) { setError(copy.errorPhone); return false; }
      if (!isValidWebsite(form.website)) { setError(copy.errorWebsite); return false; }
    }
    if (current === 3) {
      const estimated = form.estimatedStudents.trim() ? Number(form.estimatedStudents) : null;
      if (estimated !== null && (!Number.isInteger(estimated) || estimated < 0 || estimated > 1_000_000)) {
        setError(`${copy.errorInvalidFields}: ${copy.estimatedStudents}.`);
        return false;
      }
      if (!documents.representativeId || (isCompany && !documents.businessRegistration)) { setError(copy.errorDocuments); return false; }
    }
    setError(""); return true;
  }
  async function submit() {
    if (!form.consentAccepted) { setError(copy.errorConsent); return; }
    if (!selectedTemplate) { setError(copy.unavailable); return; }
    if (!validateStep(1)) { setStep(1); return; }
    if (!validateStep(2)) { setStep(2); return; }
    if (!validateStep(3)) { setStep(3); return; }
    setSubmitting(true); setError("");
    const idempotencyKey = localStorage.getItem("fas_agency_application_idempotency") || crypto.randomUUID();
    localStorage.setItem("fas_agency_application_idempotency", idempotencyKey);
    const payload = {
      ...form,
      website: normalizeWebsite(form.website),
      emailVerificationToken: emailToken,
      documents: { logo: documents.logo || null, representativeId: documents.representativeId, businessRegistration: documents.businessRegistration || null },
      estimatedStudents: form.estimatedStudents ? Number(form.estimatedStudents) : null,
      operatingCountries: stringList(form.operatingCountries),
      recruitmentMarkets: stringList(form.recruitmentMarkets),
    };
    try {
      const revision = existing?.status === "changes_requested" && accessToken;
      const response = await customFetch<{ data: { application: PublicApplication; accessToken: string | null } }>(revision ? `/api/public/agent-applications/${encodeURIComponent(accessToken)}` : "/api/public/agent-applications", { method: revision ? "PATCH" : "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey }, body: JSON.stringify(payload) });
      const token = response.data.accessToken || accessToken;
      if (token) { sessionStorage.setItem("fas_agency_application_token", token); setAccessToken(token); }
      setExisting(response.data.application);
      window.history.replaceState(null, "", `/${lang}/agency/apply`);
    } catch (cause: any) {
      const fieldErrors = cause?.data?.details?.fieldErrors as Record<string, string[] | undefined> | undefined;
      const invalidKeys = fieldErrors
        ? Object.entries(fieldErrors).filter(([, messages]) => Array.isArray(messages) && messages.length > 0).map(([field]) => field)
        : [];
      if (invalidKeys.length > 0) {
        const labels: Record<string, string> = {
          firstName: copy.firstName, lastName: copy.lastName, email: copy.email, phone: copy.phone,
          entityType: copy.entityType, preferredLanguage: copy.language, companyName: copy.companyName,
          businessName: copy.displayName, taxNumber: copy.taxNumber, country: copy.country, city: copy.city,
          state: copy.state, address: copy.address, website: copy.website, estimatedStudents: copy.estimatedStudents,
          operatingCountries: copy.operatingCountries, recruitmentMarkets: copy.recruitmentMarkets,
          documents: copy.documentsTitle, consentAccepted: copy.consent,
        };
        const first = invalidKeys[0];
        if (["firstName", "lastName", "email", "phone", "state", "address", "website"].includes(first)) setStep(2);
        else if (["estimatedStudents", "operatingCountries", "recruitmentMarkets", "documents"].includes(first)) setStep(3);
        else if (first !== "consentAccepted") setStep(1);
        setError(`${copy.errorInvalidFields}: ${invalidKeys.map((field) => labels[field] || field).join(", ")}.`);
      } else {
        setError(cause?.data?.error || cause?.message || "Application could not be submitted");
      }
    }
    finally { setSubmitting(false); }
  }
  async function startSigning() {
    if (!accessToken) return;
    setSigning(true); setError("");
    try {
      const response = await customFetch<{ data: { signPath: string } }>(`/api/public/agent-applications/${encodeURIComponent(accessToken)}/sign`, { method: "POST" });
      window.location.assign(response.data.signPath);
    } catch (cause: any) { setError(cause?.data?.error || cause?.message || "Contract could not be opened"); setSigning(false); }
  }
  function reset() {
    ["fas_agency_application_token", "fas_agency_application_idempotency"].forEach((key) => {
      sessionStorage.removeItem(key);
      localStorage.removeItem(key); // remove values left by older releases
    });
    window.location.assign(`/${lang}/agency/apply`);
  }

  if (loading) return <div className="min-h-[70vh] grid place-items-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /><span className="sr-only">{copy.loading}</span></div>;
  if (existing && existing.status !== "changes_requested") {
    const message = existing.status === "approved" ? copy.approved : existing.status === "rejected" ? copy.rejected : existing.status === "awaiting_signature" ? copy.awaitingSignature : copy.pending;
    return <section className="py-20 px-4" dir={isRTL ? "rtl" : "ltr"}><Card className="max-w-2xl mx-auto p-8 text-center space-y-5"><CheckCircle2 className="h-14 w-14 text-emerald-500 mx-auto" /><h1 className="text-3xl font-bold">{copy.applicationSaved}</h1><p className="text-muted-foreground">{message}</p><div className="grid grid-cols-2 gap-3 rounded-xl bg-muted/50 p-4 text-start"><span>{copy.reference}</span><strong>{existing.referenceCode}</strong><span>{copy.status}</span><strong className="capitalize">{existing.status.replace(/_/g, " ")}</strong></div>{existing.canStartSigning ? <Button onClick={startSigning} disabled={signing} className="w-full">{signing ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <FileSignature className="me-2 h-4 w-4" />}{signing ? copy.signing : copy.signContract}</Button> : null}{existing.status === "rejected" ? <Button variant="outline" onClick={reset}>{copy.startNew}</Button> : null}{error ? <ErrorBox message={error} /> : null}</Card></section>;
  }
  if (!matrix.length) return <section className="py-20 px-4"><Card className="max-w-2xl mx-auto p-8 text-center"><AlertCircle className="h-12 w-12 text-amber-500 mx-auto mb-4" /><p>{copy.unavailable}</p></Card></section>;

  return <section className="py-14 md:py-20 px-4 bg-gradient-to-b from-primary/5 to-background min-h-[80vh]" dir={isRTL ? "rtl" : "ltr"}><div className="max-w-4xl mx-auto space-y-7">
    <div className="text-center"><div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 text-sm font-semibold text-primary"><Building2 className="h-4 w-4" />{copy.badge}</div><h1 className="mt-5 text-3xl md:text-5xl font-bold">{copy.title}</h1><p className="mt-4 text-muted-foreground max-w-2xl mx-auto">{copy.subtitle}</p></div>
    {existing?.status === "changes_requested" ? <Card className="p-4 border-amber-300 bg-amber-50 text-amber-950"><strong>{copy.changesRequested}</strong><p className="mt-1 text-sm">{existing.changeRequestMessage}</p></Card> : null}
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">{copy.steps.map((label, index) => <div key={label} className={`rounded-xl px-3 py-3 text-center text-sm font-medium ${step === index + 1 ? "bg-primary text-primary-foreground" : step > index + 1 ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>{index + 1}. {label}</div>)}</div>
    <Card className="p-5 md:p-8 shadow-lg border-border/70">
      {step === 1 ? <div className="space-y-6"><div className="grid md:grid-cols-2 gap-5"><Field label={copy.language}><Select value={form.preferredLanguage} onValueChange={(value) => setField("preferredLanguage", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{languages.map((value) => <SelectItem key={value} value={value}><LanguageOption value={value} /></SelectItem>)}</SelectContent></Select></Field><Field label={copy.entityType}><Select value={form.entityType} onValueChange={selectEntity}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{entityTypes.map((value) => <SelectItem key={value} value={value}>{normalize(value) === "company" ? copy.company : copy.individual}</SelectItem>)}</SelectContent></Select></Field></div><div className="grid md:grid-cols-2 gap-4">{entityTypes.map((value) => <button key={value} type="button" onClick={() => selectEntity(value)} className={`text-start rounded-xl border-2 p-4 ${normalize(form.entityType) === normalize(value) ? "border-primary bg-primary/5" : "border-border"}`}><strong>{normalize(value) === "company" ? copy.company : copy.individual}</strong><span className="block text-sm text-muted-foreground mt-1">{normalize(value) === "company" ? copy.companyHint : copy.individualHint}</span></button>)}</div><div className="grid md:grid-cols-2 gap-5">{isCompany ? <TextField label={copy.companyName} required value={form.companyName} onChange={(value) => setField("companyName", value)} /> : null}<TextField label={copy.displayName} required value={form.businessName} onChange={(value) => setField("businessName", value)} />{isCompany ? <TextField label={copy.taxNumber} value={form.taxNumber} onChange={(value) => setField("taxNumber", value)} /> : null}</div><div className="grid md:grid-cols-2 gap-5"><Field label={`${copy.country} *`}><Select value={form.country} onValueChange={(value) => setForm((current) => ({ ...current, country: value, city: "" }))}><SelectTrigger><SelectValue placeholder={copy.country} /></SelectTrigger><SelectContent className="max-h-72">{countries.map((country) => <SelectItem key={country.id} value={country.name}><span className="inline-flex items-center gap-2"><CountryFlag code={country.code} size="sm" alt="" /><span>{country.name}</span></span></SelectItem>)}</SelectContent></Select></Field><Field label={`${copy.city} *`}><Select value={form.city} onValueChange={(value) => setField("city", value)} disabled={!selectedCountry || citiesLoading || cityOptions.length === 0}><SelectTrigger><SelectValue placeholder={copy.city} /></SelectTrigger><SelectContent className="max-h-72">{cityOptions.map((city) => <SelectItem key={city} value={city}>{city}</SelectItem>)}</SelectContent></Select></Field></div><div className="flex justify-end"><Button onClick={() => { if (validateStep(1)) setStep(2); }}>{copy.continue}<ArrowRight className="ms-2 h-4 w-4" /></Button></div></div> : null}
      {step === 2 ? <div className="space-y-6"><h2 className="text-xl font-bold">{copy.contactTitle}</h2><div className="grid md:grid-cols-2 gap-5"><TextField label={copy.firstName} required value={form.firstName} onChange={(value) => setField("firstName", value)} /><TextField label={copy.lastName} required value={form.lastName} onChange={(value) => setField("lastName", value)} /></div><Field label={`${copy.email} *`}><div className="flex gap-2"><Input type="email" value={form.email} onChange={(event) => changeEmail(event.target.value)} disabled={Boolean(emailToken)} /><Button type="button" variant="outline" onClick={emailToken ? () => { setEmailToken(""); setVerificationSent(false); } : requestVerification} disabled={verifying}>{emailToken ? <RefreshCw className="h-4 w-4" /> : verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : copy.verifyEmail}</Button></div>{verificationSent && !emailToken ? <div className="mt-2 flex flex-col sm:flex-row gap-2"><Input inputMode="numeric" maxLength={6} value={emailCode} onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, ""))} placeholder={copy.code} /><Button type="button" onClick={confirmVerification} disabled={verifying || emailCode.length !== 6}>{copy.confirmCode}</Button></div> : null}{verificationSent && !emailToken ? <p className="text-xs text-muted-foreground">{copy.verificationSent}</p> : null}{emailToken ? <p className="text-sm text-emerald-700 flex items-center gap-2"><MailCheck className="h-4 w-4" />{copy.verified}</p> : null}</Field><Field label={`${copy.phone} *`}><PhoneInput value={form.phone} onChange={(value) => setField("phone", value)} className="[&>button]:h-10 [&>input]:h-10" /></Field><div className="grid md:grid-cols-2 gap-5"><TextField label={copy.website} type="url" value={form.website} onChange={(value) => setField("website", value)} /><TextField label={copy.state} value={form.state} onChange={(value) => setField("state", value)} /></div><TextField label={copy.address} required value={form.address} onChange={(value) => setField("address", value)} /><div className="flex justify-between"><Button variant="outline" onClick={() => setStep(1)}><ArrowLeft className="me-2 h-4 w-4" />{copy.back}</Button><Button onClick={() => { if (validateStep(2)) setStep(3); }}>{copy.continue}<ArrowRight className="ms-2 h-4 w-4" /></Button></div></div> : null}
      {step === 3 ? <div className="space-y-6">
        <h2 className="text-xl font-bold">{copy.documentsTitle}</h2>
        <div className="grid md:grid-cols-3 gap-4">
          <DocumentField label={copy.logo} requirement={copy.optional} document={documents.logo} busy={uploading === "logo"} help={`${copy.uploadHelp} · ${copy.maxFile}`} onFile={(file) => uploadDocument("logo", file)} />
          <DocumentField label={copy.representativeId} requirement={copy.required} document={documents.representativeId} busy={uploading === "representativeId"} help={`${copy.uploadHelp} · ${copy.maxFile}`} onFile={(file) => uploadDocument("representativeId", file)} />
          {isCompany ? <DocumentField label={copy.businessRegistration} requirement={copy.required} document={documents.businessRegistration} busy={uploading === "businessRegistration"} help={`${copy.uploadHelp} · ${copy.maxFile}`} onFile={(file) => uploadDocument("businessRegistration", file)} /> : null}
        </div>
        <div className="grid md:grid-cols-3 gap-5">
          <TextField label={copy.estimatedStudents} type="number" value={form.estimatedStudents} onChange={(value) => setField("estimatedStudents", value)} />
          <Field label={copy.operatingCountries}>
            <MultiSelectFilter
              values={stringList(form.operatingCountries)}
              onChange={(values) => setField("operatingCountries", values.join(", "))}
              options={countryOptions}
              placeholder={copy.selectCountries}
              searchPlaceholder={copy.searchCountries}
              noResultsText={copy.noCountries}
              clearAllText={copy.clearAll}
              selectedText={(count) => `${count} ${copy.selected}`}
              className="[&>button]:h-10"
            />
          </Field>
          <Field label={copy.recruitmentMarkets}>
            <MultiSelectFilter
              values={stringList(form.recruitmentMarkets)}
              onChange={(values) => setField("recruitmentMarkets", values.join(", "))}
              options={countryOptions}
              placeholder={copy.selectCountries}
              searchPlaceholder={copy.searchCountries}
              noResultsText={copy.noCountries}
              clearAllText={copy.clearAll}
              selectedText={(count) => `${count} ${copy.selected}`}
              className="[&>button]:h-10"
            />
          </Field>
        </div>
        <div className="flex justify-between"><Button variant="outline" onClick={() => setStep(2)}><ArrowLeft className="me-2 h-4 w-4" />{copy.back}</Button><Button onClick={() => { if (validateStep(3)) setStep(4); }}>{copy.continue}<ArrowRight className="ms-2 h-4 w-4" /></Button></div>
      </div> : null}
      {step === 4 ? <div className="space-y-6"><h2 className="text-xl font-bold">{copy.reviewTitle}</h2><div className="rounded-xl bg-muted/50 p-5 grid md:grid-cols-2 gap-4 text-sm"><Summary label={copy.entityType} value={isCompany ? copy.company : copy.individual} /><Summary label={copy.language} value={optionLabel(form.preferredLanguage)} /><Summary label={copy.displayName} value={form.businessName} /><Summary label={copy.country} value={`${form.city}, ${form.country}`} /><Summary label={`${copy.firstName} / ${copy.lastName}`} value={`${form.firstName} ${form.lastName}`} /><Summary label={copy.email} value={form.email} /><Summary label={copy.phone} value={form.phone} /><Summary label={copy.contract} value={selectedTemplate ? `${selectedTemplate.title} · v${selectedTemplate.version}` : "—"} /></div><div className="rounded-xl border p-4"><strong>{copy.automaticContract}</strong></div><div className="flex gap-3 rounded-xl border p-4"><Checkbox id="agency-consent" checked={form.consentAccepted} onCheckedChange={(value) => setField("consentAccepted", value === true)} /><Label htmlFor="agency-consent" className="font-normal leading-6 cursor-pointer">{copy.consent}</Label></div><div className="flex gap-3 rounded-xl bg-emerald-50 text-emerald-950 p-4"><ShieldCheck className="h-5 w-5 shrink-0 mt-0.5" /><div><strong>{copy.security}</strong><p className="text-sm mt-1">{copy.securityText}</p></div></div><div className="flex justify-between"><Button variant="outline" onClick={() => setStep(3)}><ArrowLeft className="me-2 h-4 w-4" />{copy.back}</Button><Button onClick={submit} disabled={submitting}>{submitting ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <FileCheck2 className="me-2 h-4 w-4" />}{existing ? copy.updateApplication : submitting ? copy.submitting : copy.submit}</Button></div></div> : null}
      {error ? <div className="mt-5"><ErrorBox message={error} /></div> : null}
    </Card>
  </div></section>;
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <div className="space-y-2"><Label>{label}</Label>{children}</div>; }
function TextField({ label, value, onChange, required, hint, type = "text" }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; hint?: string; type?: string }) { return <Field label={`${label}${required ? " *" : ""}`}><Input type={type} value={value} onChange={(event) => onChange(event.target.value)} min={type === "number" ? 0 : undefined} max={type === "number" ? 1_000_000 : undefined} step={type === "number" ? 1 : undefined} />{hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}</Field>; }
function DocumentField({ label, requirement, document, busy, help, onFile }: { label: string; requirement: string; document?: UploadDocument | null; busy: boolean; help: string; onFile: (file: File) => void }) { return <div className="rounded-xl border p-4 space-y-3"><div><strong>{label}</strong><span className="ms-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{requirement}</span></div><label className="min-h-28 rounded-lg border-2 border-dashed flex cursor-pointer flex-col items-center justify-center gap-2 text-center p-3 hover:bg-muted/40"><Input className="sr-only" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) onFile(file); event.currentTarget.value = ""; }} />{busy ? <Loader2 className="h-6 w-6 animate-spin" /> : document ? <FileCheck2 className="h-6 w-6 text-emerald-600" /> : <Upload className="h-6 w-6" />}<span className="text-sm font-medium break-all">{document?.name || label}</span></label><p className="text-xs text-muted-foreground">{help}</p></div>; }
function Summary({ label, value }: { label: string; value: string }) { return <div><span className="text-muted-foreground block">{label}</span><strong className="mt-1 block break-words">{value}</strong></div>; }
function ErrorBox({ message }: { message: string }) { return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{message}</div>; }
