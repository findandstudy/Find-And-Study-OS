import { useState } from "react";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/use-i18n";
import { useSeo } from "@/hooks/use-seo";
import { Input } from "@/components/ui/input";
import { motion } from "framer-motion";
import { Mail, Phone, MapPin, Clock, MessageSquare, Send, CheckCircle } from "lucide-react";

const offices = [
  { city: "Istanbul", address: "Levent Mahallesi, Büyükdere Cad. No:45, 34394", phone: "+90 212 555 0100", email: "istanbul@educons.com" },
  { city: "London", address: "30 St Mary Axe, London EC3A 8BF, UK", phone: "+44 20 7946 0958", email: "london@educons.com" },
  { city: "Dubai", address: "Dubai Internet City, Building 4, Office 220", phone: "+971 4 555 0200", email: "dubai@educons.com" },
];

export default function Contact() {
  const { t, lang } = useI18n();
  useSeo({ title: t("seo.contactTitle"), description: t("seo.contactDesc"), lang });
  const [form, setForm] = useState({ name: "", email: "", phone: "", subject: "", message: "" });
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const [firstName, ...rest] = form.name.trim().split(" ");
      const lastName = rest.join(" ") || firstName;
      const res = await fetch(`${import.meta.env.BASE_URL}api/public/lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName,
          lastName,
          email: form.email,
          phone: form.phone || undefined,
          message: form.message,
          interestedProgram: form.subject || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Submission failed");
      }
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message || t("common.error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <PublicLayout>
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
                <p className="text-muted-foreground">{t("contact.successMessage")}</p>
                <Button onClick={() => { setSubmitted(false); setForm({ name: "", email: "", phone: "", subject: "", message: "" }); }} 
                  variant="outline" className="mt-6 rounded-full">
                  {t("contact.sendAnother")}
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="grid sm:grid-cols-2 gap-5">
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">{t("contact.fullName")} {t("contact.required")}</label>
                    <Input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))}
                      required placeholder={t("contact.namePlaceholder")} className="rounded-xl" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">{t("contact.email")} {t("contact.required")}</label>
                    <Input type="email" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))}
                      required placeholder={t("contact.emailPlaceholder")} className="rounded-xl" />
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 gap-5">
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">{t("contact.phone")}</label>
                    <Input value={form.phone} onChange={e => setForm(f => ({...f, phone: e.target.value}))}
                      placeholder={t("contact.phonePlaceholder")} className="rounded-xl" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1.5 block">{t("contact.subject")} {t("contact.required")}</label>
                    <Input value={form.subject} onChange={e => setForm(f => ({...f, subject: e.target.value}))}
                      required placeholder={t("contact.subjectPlaceholder")} className="rounded-xl" />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground mb-1.5 block">{t("contact.message")} {t("contact.required")}</label>
                  <textarea value={form.message} onChange={e => setForm(f => ({...f, message: e.target.value}))}
                    required rows={5} placeholder={t("contact.messagePlaceholder")}
                    className="w-full px-4 py-3 rounded-xl border border-border bg-background text-foreground text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all" />
                </div>
                {error && (
                  <div className="bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-xl p-3">
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
                  { icon: Mail, label: t("contact.emailLabel"), value: "hello@educons.example.com", href: "mailto:hello@educons.example.com" },
                  { icon: Phone, label: t("contact.phoneLabel"), value: "+90 212 555 0100", href: "tel:+902125550100" },
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
    </PublicLayout>
  );
}
