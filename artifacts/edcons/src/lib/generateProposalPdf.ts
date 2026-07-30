import { jsPDF } from "jspdf";

export type ProposalProgramData = {
  id: number;
  name: string;
  degree?: string | null;
  field?: string | null;
  language?: string | null;
  duration?: string | null;
  tuitionFee?: number | null;
  currency?: string | null;
  scholarship?: number | null;
  intakes?: string | null;
  commissionRate?: number | null;
  applicationFee?: number | null;
  discountedFee?: number | null;
  feeType?: string | null;
  serviceFeeAmount?: number | null;
  universityName: string;
  universityLogoUrl?: string | null;
  universityCountry?: string | null;
  universityCity?: string | null;
  universityType?: string | null;
  universityStatus?: string | null;
};

export type ProposalOptions = {
  programs: ProposalProgramData[];
  logoDataUrl?: string | null;
  companyName?: string;
  companyEmail?: string;
  companyPhone?: string;
  companyWebsite?: string;
  showCommission?: boolean;
  agentShareRate?: number | null;
  serviceFeeMarkup?: number;
  hideServiceFee?: boolean;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  accentColor?: string | null;
  successColor?: string | null;
  generatedAt?: Date;
};

type Rgb = readonly [number, number, number];

const NAVY: Rgb = [15, 23, 42];
const BODY: Rgb = [51, 65, 85];
const MUTED: Rgb = [100, 116, 139];
const SUBTLE: Rgb = [148, 163, 184];
const BORDER: Rgb = [218, 226, 238];
const LIGHT_BG: Rgb = [248, 250, 252];
const WHITE: Rgb = [255, 255, 255];
const DEFAULT_PRIMARY: Rgb = [17, 43, 91];
const DEFAULT_SECONDARY: Rgb = [37, 99, 235];
const DEFAULT_ACCENT: Rgb = [124, 58, 237];
const DEFAULT_SUCCESS: Rgb = [22, 163, 74];
const WARNING: Rgb = [194, 65, 12];
const DANGER: Rgb = [220, 38, 38];

function hexToRgb(hex: string): Rgb | null {
  const clean = hex.replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(clean)) return null;
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function mix(color: Rgb, target: Rgb, amount: number): Rgb {
  const ratio = Math.max(0, Math.min(1, amount));
  return [
    Math.round(color[0] + (target[0] - color[0]) * ratio),
    Math.round(color[1] + (target[1] - color[1]) * ratio),
    Math.round(color[2] + (target[2] - color[2]) * ratio),
  ];
}

/**
 * jsPDF's compact built-in Helvetica font keeps proposals small enough for
 * WhatsApp and email. Transliteration prevents unsupported glyphs from
 * rendering as black boxes without embedding a large Unicode font.
 */
export function proposalPdfText(value: unknown): string {
  return String(value ?? "")
    .replace(/[–—−]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[İIı]/g, "I")
    .replace(/[Şş]/g, "s")
    .replace(/[Ğğ]/g, "g")
    .replace(/[Çç]/g, "c")
    .replace(/[Üü]/g, "u")
    .replace(/[Öö]/g, "o")
    .replace(/[^\x20-\x7E]/g, "");
}

function fmt(amount: number | null | undefined, currency = "USD"): string {
  if (amount == null || !Number.isFinite(amount)) return "-";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `$${Math.round(amount).toLocaleString("en-US")}`;
  }
}

function feeOrFree(amount: number | null | undefined, currency: string): string {
  if (amount == null || amount <= 0) return "Free";
  return fmt(amount, currency);
}

export function getProposalServiceFee(
  program: Pick<ProposalProgramData, "serviceFeeAmount">,
  serviceFeeMarkup = 0,
  hideServiceFee = false,
): number | null {
  if (hideServiceFee) return null;
  const total = Math.max(0, (program.serviceFeeAmount ?? 0) + serviceFeeMarkup);
  return total > 0 ? total : null;
}

export function getProposalFirstYearTotal(
  program: Pick<
    ProposalProgramData,
    "discountedFee" | "tuitionFee" | "applicationFee" | "serviceFeeAmount"
  >,
  serviceFeeMarkup = 0,
  hideServiceFee = false,
): number | null {
  // When service fees are hidden, a combined total could reveal the hidden
  // value by subtraction. Do not expose a derived total in that mode.
  if (hideServiceFee) return null;
  const tuition = program.discountedFee ?? program.tuitionFee;
  if (tuition == null || !Number.isFinite(tuition)) return null;
  const serviceFee = getProposalServiceFee(program, serviceFeeMarkup, false) ?? 0;
  return tuition + Math.max(0, program.applicationFee ?? 0) + serviceFee;
}

export function getProposalDateTime(date = new Date()): { date: string; time: string } {
  const turkeyDate = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
  const turkeyTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return { date: turkeyDate.replace(/\//g, "."), time: turkeyTime };
}

function dataUrlFormat(dataUrl: string): "JPEG" | "PNG" | "WEBP" {
  if (/image\/jpe?g/i.test(dataUrl)) return "JPEG";
  if (/image\/webp/i.test(dataUrl)) return "WEBP";
  return "PNG";
}

async function blobAsDataUrl(blob: Blob): Promise<string | null> {
  if (typeof FileReader === "undefined") return null;
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

async function compressLogoBlob(blob: Blob, maxSide: number, quality: number): Promise<string | null> {
  if (typeof document === "undefined" || typeof createImageBitmap === "undefined") {
    return blobAsDataUrl(blob);
  }

  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = maxSide;
    canvas.height = maxSide;
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return null;
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, maxSide, maxSide);
    const scale = Math.min((maxSide * 0.88) / bitmap.width, (maxSide * 0.88) / bitmap.height);
    const drawW = Math.max(1, Math.round(bitmap.width * scale));
    const drawH = Math.max(1, Math.round(bitmap.height * scale));
    context.drawImage(bitmap, (maxSide - drawW) / 2, (maxSide - drawH) / 2, drawW, drawH);
    bitmap.close();
    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    return null;
  }
}

async function loadCompressedLogo(
  source: string | null | undefined,
  maxSide: number,
  quality: number,
): Promise<string | null> {
  if (!source) return null;
  try {
    const response = await fetch(source);
    if (!response.ok) return null;
    return compressLogoBlob(await response.blob(), maxSide, quality);
  } catch {
    return null;
  }
}

function compactWebsite(value: string | undefined): string {
  return proposalPdfText(value ?? "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/$/, "");
}

function normaliseType(value: string | null | undefined): "public" | "private" | "other" {
  const normalised = proposalPdfText(value).toLowerCase();
  if (/public|state|government/.test(normalised)) return "public";
  if (/private|foundation/.test(normalised)) return "private";
  return "other";
}

function commonValue(values: Array<string | null | undefined>, fallback = "Multiple"): string {
  const nonEmpty = [...new Set(values.map((value) => proposalPdfText(value).trim()).filter(Boolean))];
  return nonEmpty.length === 1 ? nonEmpty[0] : fallback;
}

function effectiveTuition(program: ProposalProgramData): number | null {
  const amount = program.discountedFee ?? program.tuitionFee;
  return amount != null && Number.isFinite(amount) ? amount : null;
}

function discountData(program: ProposalProgramData): { saving: number; percent: number } | null {
  if (
    program.tuitionFee == null ||
    program.discountedFee == null ||
    program.tuitionFee <= 0 ||
    program.discountedFee >= program.tuitionFee
  ) {
    return null;
  }
  const saving = program.tuitionFee - program.discountedFee;
  return { saving, percent: Math.round((saving / program.tuitionFee) * 100) };
}

export async function buildProposalPdf(options: ProposalOptions): Promise<jsPDF> {
  const {
    programs,
    logoDataUrl,
    companyName = "Find And Study",
    companyEmail,
    companyPhone,
    companyWebsite,
    serviceFeeMarkup = 0,
    hideServiceFee = false,
    primaryColor,
    secondaryColor,
    accentColor,
    successColor,
    generatedAt = new Date(),
  } = options;

  const primary = (primaryColor && hexToRgb(primaryColor)) || DEFAULT_PRIMARY;
  const secondary = (secondaryColor && hexToRgb(secondaryColor)) || DEFAULT_SECONDARY;
  const accent = (accentColor && hexToRgb(accentColor)) || DEFAULT_ACCENT;
  const success = (successColor && hexToRgb(successColor)) || DEFAULT_SUCCESS;
  const primarySoft = mix(primary, WHITE, 0.92);
  const secondarySoft = mix(secondary, WHITE, 0.9);
  const accentSoft = mix(accent, WHITE, 0.9);
  const successSoft = mix(success, WHITE, 0.9);

  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
    compress: true,
    putOnlyUsedFonts: true,
    precision: 2,
  });

  const pageW = 210;
  const pageH = 297;
  const marginX = 14;
  const contentW = pageW - marginX * 2;
  const footerLineY = pageH - 10.5;
  const { date: dateStr, time: timeStr } = getProposalDateTime(generatedAt);

  const companyLogo = await loadCompressedLogo(logoDataUrl, 160, 0.78);
  const universityLogos = new Map<string, string | null>();
  const uniqueLogoUrls = [
    ...new Set(programs.map((program) => program.universityLogoUrl).filter(Boolean) as string[]),
  ];
  const universityLogoAliases = new Map(
    uniqueLogoUrls.map((url, index) => [url, `proposal-university-logo-${index + 1}`]),
  );
  await Promise.all(
    uniqueLogoUrls.map(async (url) => {
      universityLogos.set(url, await loadCompressedLogo(url, 72, 0.7));
    }),
  );

  function setText(color: Rgb) {
    doc.setTextColor(color[0], color[1], color[2]);
  }

  function setFill(color: Rgb) {
    doc.setFillColor(color[0], color[1], color[2]);
  }

  function setDraw(color: Rgb) {
    doc.setDrawColor(color[0], color[1], color[2]);
  }

  function fitText(value: unknown, maxWidth: number): string {
    const safe = proposalPdfText(value);
    if (doc.getTextWidth(safe) <= maxWidth) return safe;
    let result = safe;
    while (result.length > 1 && doc.getTextWidth(`${result}...`) > maxWidth) result = result.slice(0, -1);
    return `${result.trimEnd()}...`;
  }

  function titleCase(value: string): string {
    return value
      .toLowerCase()
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function drawFallbackLogo(x: number, y: number, size: number, label: string, color: Rgb) {
    setFill(WHITE);
    setDraw(BORDER);
    doc.setLineWidth(0.25);
    doc.roundedRect(x, y, size, size, 2, 2, "FD");
    setText(color);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(Math.max(5.5, size * 0.55));
    const initials =
      proposalPdfText(label)
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join("")
        .toUpperCase() || "U";
    doc.text(initials, x + size / 2, y + size / 2 + 1.7, { align: "center" });
  }

  function drawLogo(
    dataUrl: string | null,
    x: number,
    y: number,
    size: number,
    label: string,
    alias: string,
    fallbackColor: Rgb,
  ) {
    if (!dataUrl) {
      drawFallbackLogo(x, y, size, label, fallbackColor);
      return;
    }
    setFill(WHITE);
    setDraw(BORDER);
    doc.setLineWidth(0.25);
    doc.roundedRect(x, y, size, size, 2, 2, "FD");
    try {
      doc.addImage(
        dataUrl,
        dataUrlFormat(dataUrl),
        x + 0.7,
        y + 0.7,
        size - 1.4,
        size - 1.4,
        alias,
        "FAST",
      );
    } catch {
      drawFallbackLogo(x, y, size, label, fallbackColor);
    }
  }

  function drawPill(
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    foreground: Rgb,
    background: Rgb,
    height = 4.5,
  ): number {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(5.1);
    const safe = fitText(text, maxWidth - 4);
    const width = Math.min(maxWidth, Math.max(10, doc.getTextWidth(safe) + 4));
    setFill(background);
    doc.roundedRect(x, y, width, height, height / 2, height / 2, "F");
    setText(foreground);
    doc.text(safe, x + width / 2, y + height * 0.68, { align: "center" });
    return width;
  }

  function drawHeader(pageNumber: number) {
    const compact = pageNumber > 1;
    const height = compact ? 28 : 39;
    setFill(primary);
    doc.rect(0, 0, pageW, height, "F");
    setFill(mix(primary, secondary, 0.55));
    doc.triangle(145, 0, pageW, 0, pageW, height, "F");
    setFill(secondary);
    doc.triangle(182, 0, pageW, 0, pageW, height, "F");

    const logoSize = compact ? 12 : 14;
    const logoX = marginX;
    const logoY = compact ? 7 : 10.5;
    drawLogo(
      companyLogo,
      logoX,
      logoY,
      logoSize,
      companyName,
      "proposal-company-logo",
      primary,
    );

    const titleX = logoX + logoSize + 3.5;
    setText(WHITE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(compact ? 12 : 14);
    doc.text(fitText(companyName.toUpperCase(), compact ? 92 : 103), titleX, compact ? 13.5 : 16.5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(compact ? 6 : 6.8);
    setText(mix(WHITE, primary, 0.12));
    doc.text(
      compact ? "PROGRAM PROPOSAL - CONTINUED" : "GLOBAL EDUCATION CONSULTANCY",
      titleX,
      compact ? 18.2 : 21.8,
    );

    const rightX = pageW - marginX;
    setText(mix(WHITE, primary, 0.13));
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.8);
    doc.text(compact ? "Prepared" : "Prepared for", rightX, compact ? 9 : 12, { align: "right" });
    setText(WHITE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(compact ? 7.8 : 9.2);
    doc.text(compact ? `${dateStr} ${timeStr}` : "Student Review", rightX, compact ? 14 : 17.5, {
      align: "right",
    });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.8);
    setText(mix(WHITE, primary, 0.13));
    doc.text(
      compact ? `${programs.length} selected programs` : `${dateStr} - ${timeStr} Istanbul`,
      rightX,
      compact ? 19 : 24,
      { align: "right" },
    );
    if (!compact) {
      drawPill(
        `${programs.length} selected program${programs.length === 1 ? "" : "s"}`,
        rightX - 31,
        27,
        31,
        WHITE,
        mix(primary, WHITE, 0.22),
        5.4,
      );
    }
  }

  function drawSectionLabel(text: string, x: number, y: number) {
    setText(MUTED);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(5.6);
    doc.text(proposalPdfText(text).toUpperCase(), x, y, { charSpace: 0.9 });
  }

  function drawOverview() {
    const top = 46;
    drawSectionLabel("Your selection at a glance", marginX, top);

    setFill(WHITE);
    setDraw(BORDER);
    doc.setLineWidth(0.25);
    doc.roundedRect(marginX, top + 3, 112, 20, 3, 3, "FD");
    doc.roundedRect(marginX + 115, top + 3, contentW - 115, 20, 3, 3, "FD");

    const summaryValues = [
      commonValue(programs.map((program) => program.degree)),
      commonValue(programs.map((program) => program.field), ""),
      commonValue(programs.map((program) => program.language)),
      commonValue(programs.map((program) => program.duration), ""),
      commonValue(programs.map((program) => program.universityCountry)),
      commonValue(programs.map((program) => program.intakes)),
    ].filter(Boolean);
    let chipX = marginX + 4;
    let chipY = top + 6.5;
    for (const value of summaryValues) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(5.5);
      const width = Math.min(34, Math.max(14, doc.getTextWidth(value) + 7));
      if (chipX + width > marginX + 108) {
        chipX = marginX + 4;
        chipY += 7.2;
      }
      setFill(primarySoft);
      setDraw(mix(primary, WHITE, 0.78));
      doc.roundedRect(chipX, chipY, width, 5.8, 1.8, 1.8, "FD");
      setText(primary);
      doc.text(fitText(value, width - 5), chipX + width / 2, chipY + 3.8, { align: "center" });
      chipX += width + 2;
    }

    const tuitionValues = programs
      .map(effectiveTuition)
      .filter((value): value is number => value != null);
    const minTuition = tuitionValues.length ? Math.min(...tuitionValues) : null;
    const maxTuition = tuitionValues.length ? Math.max(...tuitionValues) : null;
    const displayCurrency = commonValue(programs.map((program) => program.currency), "USD");
    const publicCount = programs.filter(
      (program) => normaliseType(program.universityType) === "public",
    ).length;
    const privateCount = programs.filter(
      (program) => normaliseType(program.universityType) === "private",
    ).length;
    const statsX = marginX + 119;
    setText(MUTED);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(5.6);
    doc.text("Annual tuition range", statsX, top + 10);
    setText(primary);
    doc.setFontSize(12);
    doc.text(
      minTuition == null
        ? "-"
        : `${fmt(minTuition, displayCurrency)} - ${fmt(maxTuition, displayCurrency)}`,
      statsX,
      top + 16,
    );
    setText(MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.3);
    const countParts = [
      publicCount ? `${publicCount} public` : "",
      privateCount ? `${privateCount} private` : "",
    ].filter(Boolean);
    doc.text(countParts.join("  |  ") || `${programs.length} universities`, pageW - marginX - 4, top + 20, {
      align: "right",
    });

    setFill(secondarySoft);
    setDraw(mix(secondary, WHITE, 0.7));
    doc.roundedRect(marginX, top + 27, contentW, 12, 2.6, 2.6, "FD");
    setFill(secondary);
    doc.roundedRect(marginX, top + 27, 1.3, 12, 0.65, 0.65, "F");
    setText(mix(primary, WHITE, 0.18));
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6);
    const degree = commonValue(programs.map((program) => program.degree), "selected");
    const language = commonValue(programs.map((program) => program.language), "multiple languages");
    doc.text(
      fitText(
        `Compare these ${degree} options by tuition, university, location and intake. All fees remain subject to university confirmation.`,
        contentW - 9,
      ),
      marginX + 4,
      top + 34.5,
    );

    drawSectionLabel("Data-driven quick picks", marginX, top + 44);
    drawQuickPicks(top + 47);
  }

  function drawQuickPicks(y: number) {
    const available = programs.filter((program) => effectiveTuition(program) != null);
    const lowestTuition = [...available].sort(
      (a, b) => (effectiveTuition(a) ?? Infinity) - (effectiveTuition(b) ?? Infinity),
    )[0];
    const biggestDiscount = [...programs]
      .filter((program) => discountData(program))
      .sort(
        (a, b) =>
          (discountData(b)?.percent ?? 0) - (discountData(a)?.percent ?? 0),
      )[0];
    const istanbulLowest = [...available]
      .filter((program) => /istanbul/i.test(program.universityCity || ""))
      .sort(
        (a, b) => (effectiveTuition(a) ?? Infinity) - (effectiveTuition(b) ?? Infinity),
      )[0];

    const firstYearLowest = hideServiceFee
      ? null
      : [...programs]
          .map((program) => ({
            program,
            total: getProposalFirstYearTotal(program, serviceFeeMarkup, false),
          }))
          .filter((entry): entry is { program: ProposalProgramData; total: number } => entry.total != null)
          .sort((a, b) => a.total - b.total)[0];

    const picks: Array<{
      label: string;
      program: ProposalProgramData | undefined;
      detail: string;
      color: Rgb;
    }> = [
      {
        label: firstYearLowest ? "Lowest first-year total" : "Lowest annual tuition",
        program: firstYearLowest?.program || lowestTuition,
        detail: firstYearLowest
          ? `${fmt(firstYearLowest.total, firstYearLowest.program.currency || "USD")} including visible fees`
          : lowestTuition
            ? `${fmt(effectiveTuition(lowestTuition), lowestTuition.currency || "USD")} per year`
            : "Tuition not available",
        color: success,
      },
      {
        label: biggestDiscount ? "Biggest verified discount" : "Lowest application fee",
        program:
          biggestDiscount ||
          [...programs].sort(
            (a, b) => (a.applicationFee ?? Infinity) - (b.applicationFee ?? Infinity),
          )[0],
        detail: biggestDiscount
          ? `${discountData(biggestDiscount)?.percent}% discount - save ${fmt(
              discountData(biggestDiscount)?.saving,
              biggestDiscount.currency || "USD",
            )}`
          : "Compare the application fee",
        color: WARNING,
      },
      {
        label: istanbulLowest ? "Lowest Istanbul tuition" : "Lowest tuition alternative",
        program: istanbulLowest || lowestTuition,
        detail: (istanbulLowest || lowestTuition)
          ? `${fmt(
              effectiveTuition(istanbulLowest || lowestTuition),
              (istanbulLowest || lowestTuition)?.currency || "USD",
            )} per year`
          : "Review the selected options",
        color: accent,
      },
    ];

    const gap = 2.3;
    const width = (contentW - gap * 2) / 3;
    picks.forEach((pick, index) => {
      const x = marginX + index * (width + gap);
      setFill(WHITE);
      setDraw(BORDER);
      doc.setLineWidth(0.25);
      doc.roundedRect(x, y, width, 14.8, 2.5, 2.5, "FD");
      setText(pick.color);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(4.7);
      doc.text(pick.label.toUpperCase(), x + 3, y + 4.2, { charSpace: 0.35 });
      setText(primary);
      doc.setFontSize(6.5);
      doc.text(fitText(pick.program?.universityName || "No data", width - 6), x + 3, y + 8.5);
      setText(MUTED);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(5.1);
      doc.text(fitText(pick.detail, width - 6), x + 3, y + 12.3);
    });
  }

  function drawProgramRow(program: ProposalProgramData, rank: number, y: number, featured: boolean) {
    const height = 17.4;
    const currency = program.currency || "USD";
    const tuition = effectiveTuition(program);
    const discount = discountData(program);
    const serviceFee = getProposalServiceFee(program, serviceFeeMarkup, hideServiceFee);
    const firstYearTotal = getProposalFirstYearTotal(program, serviceFeeMarkup, hideServiceFee);
    const status = proposalPdfText(program.universityStatus || "Open").toLowerCase();
    const isClosed = /closed|inactive/.test(status);
    const type = normaliseType(program.universityType);

    setFill(WHITE);
    setDraw(featured ? success : BORDER);
    doc.setLineWidth(featured ? 0.45 : 0.25);
    doc.roundedRect(marginX, y, contentW, height, 2.7, 2.7, "FD");
    if (featured) {
      setFill(success);
      doc.roundedRect(marginX, y, 1.2, height, 0.6, 0.6, "F");
    }

    const middleY = y + height / 2;
    setFill(primary);
    doc.circle(marginX + 6, middleY, 3.25, "F");
    setText(WHITE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.1);
    doc.text(String(rank), marginX + 6, middleY + 1.4, { align: "center" });

    const logoX = marginX + 12.2;
    const logoY = y + 2;
    const logo = program.universityLogoUrl
      ? universityLogos.get(program.universityLogoUrl) ?? null
      : null;
    drawLogo(
      logo,
      logoX,
      logoY,
      13.4,
      program.universityName,
      (program.universityLogoUrl && universityLogoAliases.get(program.universityLogoUrl)) ||
        `proposal-university-${program.id}`,
      primary,
    );

    const textX = logoX + 16;
    const textMax = 99;
    setText(primary);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text(fitText(program.name, textMax), textX, y + 5.2);
    setText(BODY);
    doc.setFontSize(5.8);
    doc.text(fitText(program.universityName, textMax), textX, y + 8.7);

    setText(MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(4.9);
    const location = [program.universityCity, program.universityCountry].filter(Boolean).join(", ") || "-";
    doc.text(fitText(location, 34), textX, y + 13.4);

    let chipX = textX + Math.min(37, doc.getTextWidth(fitText(location, 34)) + 3);
    if (type !== "other") {
      chipX += drawPill(
        type,
        chipX,
        y + 10.2,
        19,
        type === "public" ? secondary : accent,
        type === "public" ? secondarySoft : accentSoft,
        4.3,
      ) + 1.2;
    }
    if (featured) {
      drawPill("LOWEST TOTAL", chipX, y + 10.2, 24, success, successSoft, 4.3);
    } else if (discount) {
      drawPill(`${discount.percent}% DISCOUNT`, chipX, y + 10.2, 26, success, successSoft, 4.3);
    }

    const feeRight = pageW - marginX - 30;
    setText(primary);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.2);
    doc.text(fitText(fmt(tuition, currency), 31), feeRight, y + 6.2, { align: "right" });
    setText(MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(4.7);
    doc.text("/ year", feeRight + 1.5, y + 6.2);
    if (discount) {
      setText(SUBTLE);
      doc.setFontSize(4.4);
      doc.text(`Was ${fmt(program.tuitionFee, currency)}`, feeRight, y + 9.3, { align: "right" });
      setText(success);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(4.5);
      doc.text(`Save ${fmt(discount.saving, currency)} - ${discount.percent}%`, feeRight, y + 12.2, {
        align: "right",
      });
      if (serviceFee != null) {
        setText(MUTED);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(4.3);
        doc.text(`Service fee ${fmt(serviceFee, currency)}`, feeRight, y + 15, { align: "right" });
      }
    } else if (serviceFee != null) {
      setText(MUTED);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(4.5);
      doc.text(`Service fee ${fmt(serviceFee, currency)}`, feeRight, y + 9.4, { align: "right" });
    }
    if (firstYearTotal != null && !discount) {
      setText(BODY);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(4.6);
      doc.text(`First year ${fmt(firstYearTotal, currency)}`, feeRight, y + 15, { align: "right" });
    } else if (serviceFee == null) {
      setText(MUTED);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(4.4);
      doc.text(`Application ${feeOrFree(program.applicationFee, currency)}`, feeRight, y + 15, {
        align: "right",
      });
    }

    const statusX = pageW - marginX - 19.5;
    drawPill(
      isClosed ? "CLOSED" : "OPEN",
      statusX,
      y + 2.5,
      11.5,
      isClosed ? DANGER : success,
      isClosed ? mix(DANGER, WHITE, 0.9) : successSoft,
      4.2,
    );
    setText(primary);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(5.3);
    doc.text(fitText(program.intakes || "-", 19), statusX + 5.7, y + 10, { align: "center" });
    setText(MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(4.2);
    doc.text(
      `Application ${feeOrFree(program.applicationFee, currency)}`,
      statusX + 5.7,
      y + 13.9,
      { align: "center" },
    );
  }

  function drawProgramsLabel(y: number, continued = false) {
    drawSectionLabel(
      continued ? "Programs continued" : "Programs sorted by annual tuition",
      marginX,
      y,
    );
  }

  function drawCallToAction(y: number) {
    setFill(primary);
    doc.roundedRect(marginX, y, contentW, 11.5, 2.5, 2.5, "F");
    setText(WHITE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.8);
    doc.text("Ready to move forward?", marginX + 3, y + 4.8);
    setText(mix(WHITE, primary, 0.18));
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.1);
    doc.text(
      "Send your preferred choices to your advisor. We will review the documents and prepare the application.",
      marginX + 3,
      y + 8.2,
    );
    const contactLines = [companyEmail, companyPhone || compactWebsite(companyWebsite)]
      .filter(Boolean)
      .map(proposalPdfText);
    setText(WHITE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(5.1);
    contactLines.slice(0, 2).forEach((line, index) => {
      doc.text(fitText(line, 45), pageW - marginX - 3, y + 4.5 + index * 3.2, { align: "right" });
    });
  }

  function drawFooter(pageNumber: number, totalPages: number) {
    setDraw(BORDER);
    doc.setLineWidth(0.25);
    doc.line(marginX, footerLineY, pageW - marginX, footerLineY);
    setText(primary);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(5);
    doc.text(fitText(companyName.toUpperCase(), 45), marginX, footerLineY + 4);
    setText(MUTED);
    doc.setFont("helvetica", "normal");
    doc.text("Program Proposal", marginX + 48, footerLineY + 4);
    doc.text(`Page ${pageNumber} / ${totalPages}`, pageW - marginX, footerLineY + 4, {
      align: "right",
    });
  }

  const sortedPrograms = [...programs].sort((a, b) => {
    const left = effectiveTuition(a);
    const right = effectiveTuition(b);
    if (left == null && right == null) return a.name.localeCompare(b.name);
    if (left == null) return 1;
    if (right == null) return -1;
    return left - right;
  });

  const firstPagePrograms = sortedPrograms.slice(0, 7);
  const remainingPrograms = sortedPrograms.slice(7);
  const pages: ProposalProgramData[][] = [firstPagePrograms];
  for (let index = 0; index < remainingPrograms.length; index += 11) {
    pages.push(remainingPrograms.slice(index, index + 11));
  }

  pages.forEach((pagePrograms, pageIndex) => {
    if (pageIndex > 0) doc.addPage();
    const pageNumber = pageIndex + 1;
    drawHeader(pageNumber);
    if (pageNumber === 1) {
      drawOverview();
      drawProgramsLabel(108);
      let rowY = 111;
      pagePrograms.forEach((program, index) => {
        drawProgramRow(program, index + 1, rowY, index === 0);
        rowY += 19.2;
      });
      if (pages.length === 1) drawCallToAction(Math.min(266, rowY + 1.5));
    } else {
      drawProgramsLabel(35, true);
      let rowY = 38;
      pagePrograms.forEach((program, index) => {
        const absoluteRank = 7 + (pageIndex - 1) * 11 + index + 1;
        drawProgramRow(program, absoluteRank, rowY, false);
        rowY += 19.2;
      });
      if (pageNumber === pages.length) drawCallToAction(Math.min(267, rowY + 1.5));
    }
  });

  const totalPages = doc.getNumberOfPages();
  for (let page = 1; page <= totalPages; page++) {
    doc.setPage(page);
    drawFooter(page, totalPages);
  }

  return doc;
}

export async function generateProposalPdf(options: ProposalOptions): Promise<void> {
  const doc = await buildProposalPdf(options);
  const { date, time } = getProposalDateTime(options.generatedAt);
  const safeName =
    proposalPdfText(options.companyName || "Find And Study")
      .trim()
      .replace(/\s+/g, "_")
      .replace(/[^A-Za-z0-9_-]/g, "") || "Proposal";
  doc.save(`${safeName}_Program_Proposal_${date.replace(/\./g, "-")}_${time.replace(":", "-")}.pdf`);
}
