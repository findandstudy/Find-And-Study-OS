import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { toLatinUpper } from "@/lib/textTransform";
import { useI18n } from "@/hooks/use-i18n";
import { useSeo } from "@/hooks/use-seo";
import { useJsonLd, SITE_URL, SITE_NAME } from "@/hooks/use-json-ld";
import { Input } from "@/components/ui/input";
import { motion } from "framer-motion";
import { Mail, Phone, MapPin, Clock, MessageSquare, Send, CheckCircle } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

const PHONE_CODES = [
  { code: "+90", country: "TR" }, { code: "+1", country: "US" }, { code: "+44", country: "GB" },
  { code: "+49", country: "DE" }, { code: "+33", country: "FR" }, { code: "+39", country: "IT" },
  { code: "+34", country: "ES" }, { code: "+31", country: "NL" }, { code: "+46", country: "SE" },
  { code: "+47", country: "NO" }, { code: "+45", country: "DK" }, { code: "+41", country: "CH" },
  { code: "+43", country: "AT" }, { code: "+48", country: "PL" }, { code: "+7", country: "RU" },
  { code: "+380", country: "UA" }, { code: "+86", country: "CN" }, { code: "+81", country: "JP" },
  { code: "+82", country: "KR" }, { code: "+91", country: "IN" }, { code: "+92", country: "PK" },
  { code: "+93", country: "AF" }, { code: "+966", country: "SA" }, { code: "+971", country: "AE" },
  { code: "+964", country: "IQ" }, { code: "+98", country: "IR" }, { code: "+962", country: "JO" },
  { code: "+961", country: "LB" }, { code: "+20", country: "EG" }, { code: "+212", country: "MA" },
  { code: "+234", country: "NG" }, { code: "+27", country: "ZA" }, { code: "+55", country: "BR" },
  { code: "+52", country: "MX" }, { code: "+54", country: "AR" }, { code: "+61", country: "AU" },
  { code: "+64", country: "NZ" }, { code: "+60", country: "MY" }, { code: "+65", country: "SG" },
  { code: "+63", country: "PH" }, { code: "+66", country: "TH" }, { code: "+84", country: "VN" },
  { code: "+62", country: "ID" }, { code: "+994", country: "AZ" }, { code: "+995", country: "GE" },
  { code: "+998", country: "UZ" }, { code: "+996", country: "KG" }, { code: "+993", country: "TM" },
  { code: "+77", country: "KZ" },
];
const LATIN_RE = /^[A-Za-zÀ-ÖØ-öø-ÿĀ-ſ\s'-]*$/;
const LATIN_MSG_RE = /^[A-Za-zÀ-ÖØ-öø-ÿĀ-ſ0-9\s.,;:!?'"\-()@#&/]*$/;
const HTML_RE = /<[^>]*>/;
const MSG_MAX = 400;

function stripHtml(val: string): string {
  return val.replace(/<[^>]*>/g, "");
}

function latinOnly(val: string): string {
  return toLatinUpper(stripHtml(val));
}

function latinMsgOnly(val: string): string {
  return stripHtml(val).replace(/[^A-Za-zÀ-ÖØ-öø-ÿĀ-ſ0-9\s.,;:!?'"\-()@#&/]/g, "").toUpperCase();
}

type CountryRow = { id: number; name: string; code: string; flagEmoji?: string | null; isActive: boolean };

export default function Contact() {
  const { t, lang } = useI18n();

  const offices = [
    { city: t("contact.office0City"), address: t("contact.office0Address"), phone: "+90 552 689 8515", email: "info@findandstudy.com" },
    { city: t("contact.office1City"), address: t("contact.office1Address"), phone: "+90 552 689 8515", email: "info@findandstudy.com" },
    { city: t("contact.office2City"), address: t("contact.office2Address"), phone: "+90 552 689 8515", email: "info@findandstudy.com" },
  ];

  useSeo({ title: t("seo.contactTitle"), description: t("seo.contactDesc"), lang });
  useJsonLd([
    {
      "@context": "https://schema.org",
      "@type": "ContactPage",
      "@id": `${SITE_URL}/en/contact#webpage`,
      name: `Contact ${SITE_NAME}`,
      url: `${SITE_URL}/en/contact`,
      description: "Get in touch with Find And Study. Our consultants are ready to help you plan your international education journey.",
      breadcrumb: {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
          { "@type": "ListItem", position: 2, name: "Contact", item: `${SITE_URL}/en/contact` },
        ],
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      "@id": `${SITE_URL}/#localbusiness`,
      name: SITE_NAME,
      url: SITE_URL,
      telephone: "+90-552-689-8515",
      email: "info@findandstudy.com",
      address: {
        "@type": "PostalAddress",
        streetAddress: "Levent Mahallesi, Büyükdere Cad. No:45",
        addressLocality: "Istanbul",
        postalCode: "34394",
        addressCountry: "TR",
      },
      openingHoursSpecification: {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        opens: "09:00",
        closes: "18:00",
      },
    },
  ]);
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phoneCode: "", phone: "", nationality: "", message: "" });
  const [submitted, setSubmitted] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [countries, setCountries] = useState<string[]>([]);
  const [contactFormSlug, setContactFormSlug] = useState<string | null>(null);

  useEffect(() => {
    customFetch<{ data: CountryRow[] }>("/api/countries?limit=500", { method: "GET" })
      .then(res => {
        if (res?.data) setCountries(res.data.filter(c => c.isActive).map(c => c.name).sort());
      })
      .catch(() => {});
    fetch(`${BASE_URL}/api/public/website-forms/contact/check`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.exists) setContactFormSlug("contact"); })
      .catch(() => {});
  }, []);

  const setField = (field: string, value: string) => setForm(f => ({ ...f, [field]: value }));

  const handleNameChange = (field: "firstName" | "lastName", raw: string) => {
    setField(field, latinOnly(raw));
  };

  const handleMessageChange = (raw: string) => {
    const cleaned = latinMsgOnly(raw);
    if (cleaned.length <= MSG_MAX) setField("message", cleaned);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!LATIN_RE.test(form.firstName) || !LATIN_RE.test(form.lastName)) {
      setError(t("contact.latinOnly")); return;
    }
    if (HTML_RE.test(form.message) || !LATIN_MSG_RE.test(form.message)) {
      setError(t("contact.latinOnly")); return;
    }
    if (form.message.length > MSG_MAX) {
      setError(t("contact.messageTooLong")); return;
    }
    if (form.phone && !form.phoneCode) {
      setError(t("contact.phoneCodeRequired")); return;
    }
    setLoading(true);
    setError("");
    try {
      const fullPhone = form.phone ? `${form.phoneCode}${form.phone}` : undefined;
      const payload = {
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        phone: fullPhone,
        nationality: form.nationality || undefined,
        message: form.message,
      };
      const endpoint = contactFormSlug
        ? `${BASE_URL}/api/public/website-forms/${contactFormSlug}/submit`
        : `${BASE_URL}/api/public/lead`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contactFormSlug ? { ...payload, _hp: "" } : payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.message || data?.error || "Submission failed");
      }
      if (data?.message) setSuccessMsg(data.message);
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message || t("common.error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <section className="pt-24 pb-16 bg-gradient-to-br from-primary/5 to-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <span className="inline-flex items-center gap-2 bg-primary/10 text-primary text-sm font-semibold px-4 py-2 rounded-full mb-6">
              <MessageSquare className="w-4 h-4" /> {t("contact.badge")}
            </span>
            <h1 className="text-4xl md:text-6xl font-display font-bold text-foreground mb-6">
              {t("contact.title")} <span className="text-primary">{t("contact.titleHighlight")}</span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              {t("contact.subtitle")}
            </p>
          </motion.div>
        </div>
      </section>

      <section className="py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid lg:grid-cols-2 gap-16">
          <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }}>
            <h2 className="text-2xl font-display font-bold text-foreground mb-2">{t("contact.formTitle")}</h2>
            <p className="text-muted-foreground mb-8">{t("contact.formSubtitle")}</p>

            {submitted ? (
              <div className="bg-green-50 border border-green-200 rounded-2xl p-10 text-center">
                <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
                <h3 className="text-xl font-display font-bold text-foreground mb-2">{t("contact.successTitle")}</h3>
                <p className="text-muted-foreground">{successMsg || t("contact.successMessage")}</p>
                <Button onClick={() => { setSubmitted(false); setSuccessMsg(""); setForm({ firstName: "", lastName: "", email: "", phoneCode: "", phone: "", nationality: "", message: "" }); }} 
                  variant="outline" className="mt-6 rounded-full">
                  {t("contact.sendAnother")}
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="grid sm:grid-cols-2 gap-5">
                  <div>
                    <label htmlFor="contact-first-name" className="text-sm font-medium text-foreground mb-1.5 block">
                      {t("contact.firstName")} <span className="text-destructive" aria-hidden="true">*</span>
                    </label>
                    <Input id="contact-first-name" value={form.firstName} onChange={e => handleNameChange("firstName", e.target.value)}
                      required aria-required="true" placeholder={t("contact.firstNamePlaceholder")} className="rounded-xl uppercase" />
                  </div>
                  <div>
                    <label htmlFor="contact-last-name" className="text-sm font-medium text-foreground mb-1.5 block">
                      {t("contact.lastName")} <span className="text-destructive" aria-hidden="true">*</span>
                    </label>
                    <Input id="contact-last-name" value={form.lastName} onChange={e => handleNameChange("lastName", e.target.value)}
                      required aria-required="true" placeholder={t("contact.lastNamePlaceholder")} className="rounded-xl uppercase" />
                  </div>
                </div>
                <div>
                  <label htmlFor="contact-email" className="text-sm font-medium text-foreground mb-1.5 block">
                    {t("contact.email")} <span className="text-destructive" aria-hidden="true">*</span>
                  </label>
                  <Input id="contact-email" type="email" value={form.email} onChange={e => setField("email", e.target.value)}
                    required aria-required="true" placeholder={t("contact.emailPlaceholder")} className="rounded-xl" />
                </div>
                <div className="grid sm:grid-cols-2 gap-5">
                  <div>
                    <label htmlFor="contact-phone" className="text-sm font-medium text-foreground mb-1.5 block">
                      {t("contact.phone")} <span className="text-destructive" aria-hidden="true">*</span>
                    </label>
                    <div className="flex gap-2">
                      <select
                        value={form.phoneCode}
                        onChange={e => setField("phoneCode", e.target.value)}
                        aria-label={t("contact.phoneCode")}
                        required aria-required="true"
                        className="h-10 rounded-xl border border-input bg-background px-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 w-24">
                        <option value="">{t("contact.phoneCode")}</option>
                        {PHONE_CODES.map(pc => (
                          <option key={pc.code} value={pc.code}>{pc.country} {pc.code}</option>
                        ))}
                      </select>
                      <Input id="contact-phone" value={form.phone} onChange={e => setField("phone", e.target.value.replace(/[^0-9]/g, ""))}
                        required aria-required="true" placeholder={t("contact.phonePlaceholder")} className="rounded-xl flex-1" />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="contact-nationality" className="text-sm font-medium text-foreground mb-1.5 block">
                      {t("contact.nationality")} <span className="text-destructive" aria-hidden="true">*</span>
                    </label>
                    {countries.length > 0 ? (
                      <select
                        id="contact-nationality"
                        value={form.nationality}
                        onChange={e => setField("nationality", e.target.value)}
                        required
                        aria-required="true"
                        className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
                        <option value="">{t("contact.nationalityPlaceholder")}</option>
                        {countries.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    ) : (
                      <Input id="contact-nationality" value={form.nationality} onChange={e => setField("nationality", e.target.value)}
                        required aria-required="true" placeholder={t("contact.nationalityPlaceholder")} className="rounded-xl" />
                    )}
                  </div>
                </div>
                <div>
                  <label htmlFor="contact-message" className="text-sm font-medium text-foreground mb-1.5 block">
                    {t("contact.message")}
                  </label>
                  <textarea
                    id="contact-message"
                    value={form.message}
                    onChange={e => handleMessageChange(e.target.value)}
                    rows={5}
                    placeholder={t("contact.messagePlaceholder")}
                    maxLength={MSG_MAX}
                    aria-describedby="contact-message-count"
                    className="w-full px-4 py-3 rounded-xl border border-border bg-background text-foreground text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all uppercase" />
                  <p id="contact-message-count" className="text-xs text-muted-foreground mt-1 text-right" aria-live="polite">
                    {form.message.length}/{MSG_MAX}
                  </p>
                </div>
                {error && (
                  <div role="alert" aria-live="assertive" className="bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-xl p-3">
                    {error}
                  </div>
                )}
                <Button type="submit" disabled={loading} size="lg" className="w-full rounded-xl">
                  {loading ? (
                    <div className="flex items-center gap-2"><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> {t("contact.sending")}</div>
                  ) : (
                    <div className="flex items-center gap-2"><Send className="w-4 h-4" /> {t("contact.send")}</div>
                  )}
                </Button>
              </form>
            )}
          </motion.div>

          <motion.div initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} className="space-y-8">
            <div>
              <h2 className="text-2xl font-display font-bold text-foreground mb-6">{t("contact.quickContact")}</h2>
              <div className="space-y-4">
                {[
                  { icon: Mail, label: t("contact.emailLabel"), value: "info@findandstudy.com", href: "mailto:info@findandstudy.com" },
                  { icon: Phone, label: t("contact.phoneLabel"), value: "+90 552 689 8515", href: "tel:+905526898515" },
                  { icon: Clock, label: t("contact.hoursLabel"), value: t("contact.hoursValue"), href: undefined },
                ].map((c, i) => (
                  <a key={i} href={c.href || '#'}
                    className="flex items-center gap-4 p-4 rounded-2xl bg-secondary/50 hover:bg-primary/5 transition-colors group">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                      <c.icon className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground font-medium">{c.label}</p>
                      <p className="text-foreground font-semibold">{c.value}</p>
                    </div>
                  </a>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-xl font-display font-bold text-foreground mb-6">{t("contact.ourOffices")}</h3>
              <div className="space-y-4">
                {offices.map((office, i) => (
                  <div key={i} className="p-5 rounded-2xl border border-border/60 hover:border-primary/30 transition-colors">
                    <div className="flex items-center gap-2 mb-3">
                      <MapPin className="w-4 h-4 text-primary" />
                      <h4 className="font-display font-bold text-foreground">{office.city}</h4>
                    </div>
                    <p className="text-muted-foreground text-sm mb-2">{office.address}</p>
                    <p className="text-sm font-medium text-foreground">{office.phone}</p>
                    <p className="text-sm text-primary">{office.email}</p>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </section>
    </>
  );
}
