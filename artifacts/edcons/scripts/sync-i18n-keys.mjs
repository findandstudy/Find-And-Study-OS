#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TR_DIR = join(__dirname, "..", "src", "lib", "i18n", "translations");

const NEW_KEYS_EN = {
  dashboard: {
    website: "Website",
    websitePages: "Pages",
    websiteGlobalComponents: "Global Components",
    websiteNavigation: "Navigation",
    websiteBlog: "Blog",
    websiteCollections: "Collections",
    websiteForms: "Forms",
    websiteSeoOverrides: "SEO Overrides",
    websiteThemeBuilder: "Theme Builder",
    websiteTranslations: "Translations",
    websitePublishHistory: "Publish History",
    homeTooltip: "Home",
    addToFavorites: "Add to favorites",
    removeFromFavorites: "Remove from favorites",
    assignedToYou: "{n} assigned to you",
    totalUnread: "{n} total unread",
    favorites: "Favorites",
  },
  common: {
    system: "System",
    justNow: "Just now",
    minutesAgo: "{n}m ago",
    hoursAgo: "{n}h ago",
    daysAgo: "{n}d ago",
    expiredAgo: "Expired {n}d ago",
    daysLeft: "{n}d left",
    overdue: "Overdue",
  },
  staffDash: {
    welcomeBack: "Welcome Back",
    welcomeSubtitle: "Here's what's happening with your consultancy today.",
    totalLeads: "Total Leads",
    activeApplications: "Active Applications",
    studentsEnrolled: "Students Enrolled",
    revenueMonth: "Revenue (Month)",
    contractAlerts: "Contract Alerts",
    agentsNeedAttention: "{count} agent(s) need attention",
    growthOverview: "Growth Overview",
    upcomingFollowUps: "Upcoming Follow-ups",
    noFollowUps: "No upcoming follow-ups.",
    quickLinks: "Quick Links",
    latestStudents: "Latest Students",
    noStudents: "No students yet.",
    latestUpdates: "Latest Updates",
    noUpdates: "No recent updates.",
    notifications: "Notifications",
    noNotifications: "No notifications.",
    viewAll: "View All",
  },
  agentDash: {
    title: "Agent Portal",
    subtitle: "Track your students, commissions, and application progress",
    totalStudents: "Total Students",
    activeApplications: "Active Applications",
    enrolled: "Enrolled",
    totalLeads: "Total Leads",
    growthOverview: "Growth Overview",
    yourContactPerson: "Your Contact Person",
    sendMessage: "Send Message",
    quickActions: "Quick Actions",
    addLead: "Add Lead",
    addStudent: "Add Student",
    quickLinks: "Quick Links",
    latestStudents: "Latest Students",
    noStudents: "No students yet.",
    latestUpdates: "Latest Updates",
    noUpdates: "No recent updates.",
    notifications: "Notifications",
    noNotifications: "No notifications.",
  },
  studentDash: {
    welcomeBack: "Welcome back, {name}!",
    welcomeFallback: "Student",
    appProgressing: "Your application is progressing well.",
    letsStart: "Let's start your global education journey.",
    applications: "Applications",
    documents: "Documents",
    pendingDocs: "Pending Docs",
    enrolled: "Enrolled",
    applicationProgress: "Application Progress",
    applicationNumber: "Application #{id}",
    startApplication: "Start Your Application",
    browsePrograms: "Browse programs and submit your first university application.",
    applyNow: "Apply Now",
    quickLinks: "Quick Links",
    myDocuments: "My Documents",
    noDocuments: "No documents uploaded yet",
    uploadDocument: "Upload Document",
    yourAdvisor: "Your Advisor",
    messageAdvisor: "Message Advisor",
    noAdvisor: "No advisor assigned yet",
    advisorWillBeAssigned: "An advisor will be assigned to you soon",
    consultant: "Consultant",
    stageInquiry: "Inquiry Received",
    stageDocumentsCollected: "Documents Collected",
    stageSubmitted: "Submitted",
    stageOfferReceived: "Offer Received",
    stageVisaApplied: "Visa Applied",
    stageVisaApproved: "Visa Approved",
    stageEnrolled: "Enrolled",
    stageRejected: "Rejected",
    docStatusApproved: "Approved",
    docStatusRejected: "Rejected",
    docStatusPending: "Pending",
    docStatusRequested: "Requested",
    docStatusUnderReview: "Under Review",
  },
};

const NEW_KEYS_TR = {
  dashboard: {
    website: "Web Sitesi",
    websitePages: "Sayfalar",
    websiteGlobalComponents: "Global Bileşenler",
    websiteNavigation: "Navigasyon",
    websiteBlog: "Blog",
    websiteCollections: "Koleksiyonlar",
    websiteForms: "Formlar",
    websiteSeoOverrides: "SEO Geçersiz Kılma",
    websiteThemeBuilder: "Tema Oluşturucu",
    websiteTranslations: "Çeviriler",
    websitePublishHistory: "Yayın Geçmişi",
    homeTooltip: "Ana Sayfa",
    addToFavorites: "Favorilere ekle",
    removeFromFavorites: "Favorilerden çıkar",
    assignedToYou: "{n} size atandı",
    totalUnread: "{n} toplam okunmamış",
    favorites: "Favoriler",
    popupAds: "Pop-up Reklamlar",
  },
  common: {
    system: "Sistem",
    justNow: "Az önce",
    minutesAgo: "{n} dk önce",
    hoursAgo: "{n} sa önce",
    daysAgo: "{n} gün önce",
    expiredAgo: "{n} gün önce sona erdi",
    daysLeft: "{n} gün kaldı",
    overdue: "Gecikmiş",
  },
  staffDash: {
    welcomeBack: "Tekrar Hoş Geldiniz",
    welcomeSubtitle: "İşte bugün danışmanlığınızda olup bitenler.",
    totalLeads: "Toplam Müşteri Adayı",
    activeApplications: "Aktif Başvurular",
    studentsEnrolled: "Kayıtlı Öğrenciler",
    revenueMonth: "Gelir (Ay)",
    contractAlerts: "Sözleşme Uyarıları",
    agentsNeedAttention: "{count} acente dikkat gerektiriyor",
    growthOverview: "Büyüme Özeti",
    upcomingFollowUps: "Yaklaşan Takipler",
    noFollowUps: "Yaklaşan takip yok.",
    quickLinks: "Hızlı Bağlantılar",
    latestStudents: "Son Öğrenciler",
    noStudents: "Henüz öğrenci yok.",
    latestUpdates: "Son Güncellemeler",
    noUpdates: "Son güncelleme yok.",
    notifications: "Bildirimler",
    noNotifications: "Bildirim yok.",
    viewAll: "Tümünü Gör",
  },
  agentDash: {
    title: "Acente Portalı",
    subtitle: "Öğrencilerinizi, komisyonlarınızı ve başvuru durumunu takip edin",
    totalStudents: "Toplam Öğrenci",
    activeApplications: "Aktif Başvurular",
    enrolled: "Kayıtlı",
    totalLeads: "Toplam Müşteri Adayı",
    growthOverview: "Büyüme Özeti",
    yourContactPerson: "İrtibat Kişiniz",
    sendMessage: "Mesaj Gönder",
    quickActions: "Hızlı İşlemler",
    addLead: "Aday Ekle",
    addStudent: "Öğrenci Ekle",
    quickLinks: "Hızlı Bağlantılar",
    latestStudents: "Son Öğrenciler",
    noStudents: "Henüz öğrenci yok.",
    latestUpdates: "Son Güncellemeler",
    noUpdates: "Son güncelleme yok.",
    notifications: "Bildirimler",
    noNotifications: "Bildirim yok.",
  },
  studentDash: {
    welcomeBack: "Tekrar hoş geldin, {name}!",
    welcomeFallback: "Öğrenci",
    appProgressing: "Başvurun başarıyla ilerliyor.",
    letsStart: "Küresel eğitim yolculuğuna başlayalım.",
    applications: "Başvurular",
    documents: "Belgeler",
    pendingDocs: "Bekleyen Belgeler",
    enrolled: "Kayıtlı",
    applicationProgress: "Başvuru Durumu",
    applicationNumber: "Başvuru #{id}",
    startApplication: "Başvurunu Başlat",
    browsePrograms: "Programlara göz at ve ilk üniversite başvurunu yap.",
    applyNow: "Hemen Başvur",
    quickLinks: "Hızlı Bağlantılar",
    myDocuments: "Belgelerim",
    noDocuments: "Henüz belge yüklenmedi",
    uploadDocument: "Belge Yükle",
    yourAdvisor: "Danışmanın",
    messageAdvisor: "Danışmana Mesaj",
    noAdvisor: "Henüz bir danışman atanmadı",
    advisorWillBeAssigned: "Yakında bir danışman atanacak",
    consultant: "Danışman",
    stageInquiry: "Başvuru Alındı",
    stageDocumentsCollected: "Belgeler Toplandı",
    stageSubmitted: "Gönderildi",
    stageOfferReceived: "Teklif Alındı",
    stageVisaApplied: "Vize Başvuruldu",
    stageVisaApproved: "Vize Onaylandı",
    stageEnrolled: "Kayıt Yapıldı",
    stageRejected: "Reddedildi",
    docStatusApproved: "Onaylandı",
    docStatusRejected: "Reddedildi",
    docStatusPending: "Beklemede",
    docStatusRequested: "Talep Edildi",
    docStatusUnderReview: "İncelemede",
  },
};

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    const sv = source[key];
    if (sv && typeof sv === "object" && !Array.isArray(sv)) {
      if (!target[key] || typeof target[key] !== "object") target[key] = {};
      deepMerge(target[key], sv);
    } else if (target[key] === undefined) {
      target[key] = sv;
    }
  }
  return target;
}

function loadJSON(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function saveJSON(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n");
}

// 1. Add new keys to en.json (overwrite-safe — uses deepMerge so existing values win)
const enPath = join(TR_DIR, "en.json");
const en = loadJSON(enPath);
deepMerge(en, NEW_KEYS_EN);
saveJSON(enPath, en);

// 2. Add new keys to tr.json (Turkish translations)
const trPath = join(TR_DIR, "tr.json");
const tr = loadJSON(trPath);
deepMerge(tr, NEW_KEYS_TR);
saveJSON(trPath, tr);

// 3. For all other languages, fill missing keys from en.json (English fallback)
const allFiles = readdirSync(TR_DIR).filter(f => f.endsWith(".json"));
for (const file of allFiles) {
  if (file === "en.json" || file === "tr.json") continue;
  const path = join(TR_DIR, file);
  const data = loadJSON(path);
  deepMerge(data, en);
  saveJSON(path, data);
  console.log(`synced ${file}`);
}

console.log("Done.");
