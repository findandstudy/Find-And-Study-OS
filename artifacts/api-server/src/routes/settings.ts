import { Router, type IRouter } from "express";
import { Readable } from "stream";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { MANAGER_ROLES } from "../lib/roles";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";

const router: IRouter = Router();

const SETTINGS_PATCH_FIELDS = [
  "defaultLanguage", "supportedLanguages", "companyName", "companyEmail",
  "companyPhone", "companyAddress", "companyWebsite", "smtpHost", "smtpPort", "smtpUser",
  "smtpPassword", "whatsappEnabled", "whatsappToken",
  "metaLeadEnabled", "n8nWebhookUrl", "googleSheetsId",
  "logoUrl", "logoDarkUrl", "faviconUrl", "themePrimary", "themeButton", "themeHover",
  "seoDefaultTitle", "seoDefaultDescription",
  "logoSquareUrl", "appleTouchIconUrl", "pwaIconUrl", "emailLogoUrl", "pdfLogoUrl",
  "themeSecondary", "themeAccent", "themeLinkColor", "themeSuccess", "themeWarning", "themeDanger",
  "legalCompanyName", "publicBrandName", "supportEmail", "salesEmail",
  "whatsappNumber", "companyCity", "companyCountry", "workingHours",
  "footerDescription", "footerCopyright", "contactCtaText",
  "socialInstagram", "socialFacebook", "socialLinkedin", "socialTwitter", "socialYoutube", "socialTiktok",
  "siteName", "siteTitleTemplate", "seoMetaTitle", "seoMetaDescription",
  "canonicalBaseUrl", "robotsIndex", "robotsFollow", "stagingNoindex",
  "ogTitle", "ogDescription", "ogImageUrl",
  "twitterTitle", "twitterDescription", "twitterImageUrl", "shareImageUrl",
  "seoKeywords", "googleSearchConsoleCode", "googleAnalyticsId", "metaPixelId", "tiktokPixelId",
  "orgSchemaName", "orgSchemaUrl", "orgSchemaLogoUrl", "orgSchemaSocials",
  "emailSenderName", "emailSenderEmail", "emailReplyTo",
  "emailFooterText", "emailSignatureBlock", "emailButtonColor", "emailDisclaimerText",
  "pdfHeaderText", "pdfFooterText", "pdfWatermarkText", "pdfSignatureLabel",
  "pdfSealImageUrl", "pdfPrimaryColor",
  "sitemapUrl", "robotsTxtContent", "customHeadScript", "customBodyEndScript",
  "linkedinInsightTag", "clarityId", "recaptchaSiteKey",
  "whatsappWidgetNumber", "liveChatScript", "featureFlags",
  "availableYears",
];

const CREDENTIAL_FIELDS = ["smtpPassword", "whatsappToken"];
const SUPER_ADMIN_ONLY_FIELDS = ["customHeadScript", "customBodyEndScript", "liveChatScript", "featureFlags"];

router.get("/settings/branding", async (req, res): Promise<void> => {
  const [settings] = await db.select({
    logoUrl: settingsTable.logoUrl,
    logoDarkUrl: settingsTable.logoDarkUrl,
    faviconUrl: settingsTable.faviconUrl,
    themePrimary: settingsTable.themePrimary,
    themeButton: settingsTable.themeButton,
    themeHover: settingsTable.themeHover,
    companyName: settingsTable.companyName,
    publicBrandName: settingsTable.publicBrandName,
    companyEmail: settingsTable.companyEmail,
    companyPhone: settingsTable.companyPhone,
    companyAddress: settingsTable.companyAddress,
    companyCity: settingsTable.companyCity,
    companyCountry: settingsTable.companyCountry,
    companyWebsite: settingsTable.companyWebsite,
    whatsappNumber: settingsTable.whatsappNumber,
    workingHours: settingsTable.workingHours,
    footerDescription: settingsTable.footerDescription,
    footerCopyright: settingsTable.footerCopyright,
    contactCtaText: settingsTable.contactCtaText,
    socialInstagram: settingsTable.socialInstagram,
    socialFacebook: settingsTable.socialFacebook,
    socialLinkedin: settingsTable.socialLinkedin,
    socialTwitter: settingsTable.socialTwitter,
    socialYoutube: settingsTable.socialYoutube,
    socialTiktok: settingsTable.socialTiktok,
  }).from(settingsTable);
  res.json(settings || {});
});

router.get("/settings", requireAuth, async (req, res): Promise<void> => {
  const [settings] = await db.select().from(settingsTable);
  if (!settings) {
    const [created] = await db.insert(settingsTable).values({
      defaultLanguage: "en",
      supportedLanguages: "en,tr,ar,fr,ru",
      whatsappEnabled: false,
      metaLeadEnabled: false,
    }).returning();
    res.json(created);
    return;
  }
  const safe: Record<string, any> = { ...settings };
  for (const f of CREDENTIAL_FIELDS) {
    delete safe[f];
  }
  res.json(safe);
});

router.patch("/settings", requireAuth, requireRole(...MANAGER_ROLES), async (req, res): Promise<void> => {
  const userRole = (req as any).user?.role || "";
  const updates: Record<string, unknown> = {};
  for (const key of SETTINGS_PATCH_FIELDS) {
    if (req.body[key] !== undefined) {
      if (SUPER_ADMIN_ONLY_FIELDS.includes(key) && userRole !== "super_admin") continue;
      updates[key] = req.body[key];
    }
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }

  const [existing] = await db.select().from(settingsTable);
  let updated;
  if (!existing) {
    const [created] = await db.insert(settingsTable).values({
      defaultLanguage: "en",
      supportedLanguages: "en,tr,ar,fr,ru",
      whatsappEnabled: false,
      metaLeadEnabled: false,
      ...updates,
    }).returning();
    updated = created;
  } else {
    const [u] = await db.update(settingsTable).set(updates).where(eq(settingsTable.id, existing.id)).returning();
    updated = u;
  }
  const safe: Record<string, any> = { ...updated };
  for (const f of CREDENTIAL_FIELDS) {
    delete safe[f];
  }
  res.json(safe);
});

router.get("/settings/available-years", async (req, res): Promise<void> => {
  const [settings] = await db.select({ availableYears: settingsTable.availableYears }).from(settingsTable);
  const currentYear = new Date().getFullYear();
  const defaultYears = Array.from({ length: 6 }, (_, i) => currentYear - 2 + i);
  const years = (settings?.availableYears as number[] | null) || defaultYears;
  res.json({ years: years.sort((a, b) => a - b) });
});

const objectStorageService = new ObjectStorageService();

router.get("/settings/branding/logo", async (req, res): Promise<void> => {
  try {
    const variant = req.query.variant === "dark" ? "logoDarkUrl" : "logoUrl";
    const [settings] = await db.select({
      logoUrl: settingsTable.logoUrl,
      logoDarkUrl: settingsTable.logoDarkUrl,
    }).from(settingsTable);
    const url = settings?.[variant] || settings?.logoUrl;
    if (!url) { res.status(404).json({ error: "No logo configured" }); return; }

    const match = url.match(/\/api\/storage\/objects\/(.+)$/);
    if (!match) { res.status(404).json({ error: "Invalid logo path" }); return; }

    const objectPath = `/objects/${match[1]}`;
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.setHeader("Cache-Control", "public, max-age=3600");

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Logo not found" });
      return;
    }
    console.error("Error serving branding logo:", error);
    res.status(500).json({ error: "Failed to serve logo" });
  }
});

export default router;
