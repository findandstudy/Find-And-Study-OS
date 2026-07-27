import { jsPDF } from "jspdf";

export type ProposalProgramData = {
  id: number;
  name: string;
  degree?: string | null;
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
  accentColor?: string | null;
  generatedAt?: Date;
};

type Rgb = readonly [number, number, number];

const NAVY: Rgb = [15, 23, 42];
const BODY: Rgb = [71, 85, 105];
const MUTED: Rgb = [100, 116, 139];
const SUBTLE: Rgb = [148, 163, 184];
const BORDER: Rgb = [226, 232, 240];
const LIGHT_BG: Rgb = [248, 250, 252];
const WHITE: Rgb = [255, 255, 255];
const EMERALD: Rgb = [5, 150, 105];
const EMERALD_BG: Rgb = [236, 253, 245];
const DEFAULT_ACCENT: Rgb = [30, 64, 175];

function hexToRgb(hex: string): Rgb | null {
  const clean = hex.replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(clean)) return null;
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

/**
 * jsPDF's compact built-in Helvetica font is intentionally retained to keep
 * proposals small enough for email and WhatsApp. Transliteration prevents
 * unsupported glyphs from rendering as black boxes without embedding a large
 * Unicode font in every proposal.
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

export function getProposalServiceFee(
  program: Pick<ProposalProgramData, "serviceFeeAmount">,
  serviceFeeMarkup = 0,
  hideServiceFee = false,
): number | null {
  if (hideServiceFee) return null;
  const total = Math.max(0, (program.serviceFeeAmount ?? 0) + serviceFeeMarkup);
  return total > 0 ? total : null;
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

/**
 * Normalise every remote logo into a small square JPEG before it reaches
 * jsPDF. A 2000px PNG used to be embedded at full resolution even when drawn
 * at 12mm, which made otherwise tiny proposals several megabytes.
 */
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
      return blobAsDataUrl(blob);
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
    return blobAsDataUrl(blob);
  }
}

async function loadCompressedLogo(url: string, maxSide = 180, quality = 0.72): Promise<string | null> {
  try {
    const response = await fetch(url);
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
    accentColor,
    generatedAt = new Date(),
  } = options;

  const accent = (accentColor && hexToRgb(accentColor)) || DEFAULT_ACCENT;
  const accentSoft: Rgb = [
    Math.round(255 - (255 - accent[0]) * 0.09),
    Math.round(255 - (255 - accent[1]) * 0.09),
    Math.round(255 - (255 - accent[2]) * 0.09),
  ];
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
  const marginX = 12;
  const contentW = pageW - marginX * 2;
  const footerLineY = pageH - 11;
  const contentStartY = 54;
  const cardGap = 3;
  const { date: dateStr, time: timeStr } = getProposalDateTime(generatedAt);

  const companyLogo = logoDataUrl
    ? await (async () => {
        try {
          const response = await fetch(logoDataUrl);
          if (response.ok) return compressLogoBlob(await response.blob(), 320, 0.82);
        } catch {}
        return logoDataUrl;
      })()
    : null;

  const universityLogos = new Map<string, string | null>();
  const universityLogoUrls = [
    ...new Set(programs.map((program) => program.universityLogoUrl).filter(Boolean) as string[]),
  ];
  await Promise.all(
    universityLogoUrls.map(async (url) => {
      universityLogos.set(url, await loadCompressedLogo(url));
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
  function fitText(value: string, maxWidth: number): string {
    const safe = proposalPdfText(value);
    if (doc.getTextWidth(safe) <= maxWidth) return safe;
    let result = safe;
    while (result.length > 1 && doc.getTextWidth(`${result}...`) > maxWidth) result = result.slice(0, -1);
    return `${result.trimEnd()}...`;
  }
  function addLogo(dataUrl: string | null, x: number, y: number, size: number, alias: string) {
    setFill(WHITE);
    setDraw(BORDER);
    doc.setLineWidth(0.2);
    doc.roundedRect(x, y, size, size, 1.6, 1.6, "FD");
    if (!dataUrl) return;
    try {
      doc.addImage(dataUrl, dataUrlFormat(dataUrl), x + 0.7, y + 0.7, size - 1.4, size - 1.4, alias, "FAST");
    } catch {
      // A missing or malformed remote logo must never block proposal creation.
    }
  }

  function drawHeader(continued: boolean) {
    setFill(WHITE);
    doc.rect(0, 0, pageW, 36, "F");
    setFill(accent);
    doc.rect(0, 0, 4, 36, "F");

    const logoSize = 18;
    const logoX = marginX;
    const logoY = 8;
    addLogo(companyLogo, logoX, logoY, logoSize, "proposal-company-logo");

    const titleX = logoX + logoSize + 5;
    setText(NAVY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(fitText(proposalPdfText(companyName), 92), titleX, 14);

    setText(MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(continued ? "PROGRAM PROPOSAL - CONTINUED" : "PROGRAM PROPOSAL", titleX, 20);
    setText(SUBTLE);
    doc.setFontSize(6.5);
    doc.text("Prepared for student review", titleX, 25);

    const rightX = pageW - marginX;
    setText(MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.text("PREPARED ON", rightX, 11, { align: "right" });
    setText(NAVY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(`${dateStr}  ${timeStr}`, rightX, 17, { align: "right" });
    setText(SUBTLE);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.2);
    doc.text("Europe/Istanbul", rightX, 22, { align: "right" });

    setFill(LIGHT_BG);
    doc.rect(4, 30, pageW - 4, 10, "F");
    const contacts = [
      companyPhone ? `Phone  ${proposalPdfText(companyPhone)}` : "",
      companyEmail ? `Email  ${proposalPdfText(companyEmail)}` : "",
      companyWebsite ? `Web  ${compactWebsite(companyWebsite)}` : "",
    ].filter(Boolean);
    if (contacts.length) {
      const cellW = contentW / contacts.length;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      contacts.forEach((contact, index) => {
        const x = marginX + index * cellW;
        if (index > 0) {
          setDraw(BORDER);
          doc.setLineWidth(0.2);
          doc.line(x, 32, x, 38);
        }
        setText(BODY);
        doc.text(fitText(contact, cellW - 6), x + 3, 36.2);
      });
    }
    setFill(accent);
    doc.rect(4, 40, pageW - 4, 0.7, "F");
  }

  function drawSectionIntro() {
    setText(NAVY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Selected programs", marginX, 48);
    setText(MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text(
      `${programs.length} option${programs.length === 1 ? "" : "s"} selected for comparison`,
      pageW - marginX,
      48,
      { align: "right" },
    );
  }

  function cardHeight(program: ProposalProgramData): number {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    const titleLines = Math.min(
      (doc.splitTextToSize(proposalPdfText(program.name), 91) as string[]).length,
      2,
    );
    return titleLines > 1 ? 43 : 40;
  }

  function drawBadge(text: string, x: number, y: number, maxX: number): number {
    const safe = proposalPdfText(text);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(5.6);
    const width = Math.min(doc.getTextWidth(safe) + 4, maxX - x);
    if (width < 8) return x;
    setFill(accentSoft);
    doc.roundedRect(x, y, width, 4.6, 1.4, 1.4, "F");
    setText(accent);
    doc.text(fitText(safe, width - 3), x + 2, y + 3.2);
    return x + width + 1.5;
  }

  function drawProgramCard(program: ProposalProgramData, index: number, x: number, y: number, height: number) {
    const currency = program.currency || "USD";
    const effectiveTuition = program.discountedFee ?? program.tuitionFee;
    const hasDiscount =
      program.discountedFee != null &&
      program.tuitionFee != null &&
      program.discountedFee < program.tuitionFee;
    const serviceFee = getProposalServiceFee(program, serviceFeeMarkup, hideServiceFee);

    setFill(WHITE);
    setDraw(BORDER);
    doc.setLineWidth(0.25);
    doc.roundedRect(x, y, contentW, height, 2.5, 2.5, "FD");
    setFill(accent);
    doc.roundedRect(x, y, 3, height, 1.5, 1.5, "F");
    doc.rect(x + 1.5, y, 1.5, height, "F");

    const logoX = x + 7;
    const logoY = y + 6;
    const logoSize = 13;
    const logoData = program.universityLogoUrl
      ? universityLogos.get(program.universityLogoUrl) || null
      : null;
    addLogo(logoData, logoX, logoY, logoSize, `university-logo-${index}`);

    const infoX = logoX + logoSize + 4;
    const feePanelW = 48;
    const feePanelX = x + contentW - feePanelW - 4;
    const infoMaxW = feePanelX - infoX - 5;

    setText(MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.text(fitText(program.universityName, infoMaxW - 12), infoX, y + 8);

    setFill(accent);
    doc.roundedRect(infoX + infoMaxW - 10, y + 4.7, 10, 4.5, 1.2, 1.2, "F");
    setText(WHITE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(5.8);
    doc.text(String(index + 1).padStart(2, "0"), infoX + infoMaxW - 5, y + 7.8, { align: "center" });

    setText(NAVY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    const titleLines = (doc.splitTextToSize(proposalPdfText(program.name), infoMaxW) as string[]).slice(0, 2);
    titleLines.forEach((line, lineIndex) => doc.text(line, infoX, y + 14 + lineIndex * 4.5));

    let badgeX = infoX;
    const badgeY = y + (titleLines.length > 1 ? 25 : 21);
    const badges = [
      program.degree,
      program.language,
      program.duration,
      program.universityType,
      [program.universityCity, program.universityCountry].filter(Boolean).join(", "),
    ].filter(Boolean) as string[];
    for (const badge of badges) {
      const nextX = drawBadge(badge, badgeX, badgeY, feePanelX - 4);
      if (nextX === badgeX) break;
      badgeX = nextX;
    }

    setFill(accentSoft);
    doc.roundedRect(feePanelX, y + 4, feePanelW, height - 8, 2, 2, "F");
    setText(MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6);
    doc.text(proposalPdfText(`TUITION ${program.feeType ? `- ${program.feeType}` : ""}`), feePanelX + 4, y + 9);

    if (hasDiscount) {
      setText(SUBTLE);
      doc.setFontSize(6.2);
      const original = fmt(program.tuitionFee, currency);
      doc.text(original, feePanelX + feePanelW - 4, y + 14, { align: "right" });
      const originalWidth = doc.getTextWidth(original);
      setDraw(SUBTLE);
      doc.setLineWidth(0.25);
      doc.line(feePanelX + feePanelW - 4 - originalWidth, y + 12.7, feePanelX + feePanelW - 4, y + 12.7);
    }

    setText(hasDiscount ? EMERALD : NAVY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(fmt(effectiveTuition, currency), feePanelX + feePanelW - 4, y + (hasDiscount ? 20 : 17), {
      align: "right",
    });

    if (hasDiscount && program.tuitionFee) {
      const discount = Math.round(((program.tuitionFee - program.discountedFee!) / program.tuitionFee) * 100);
      setFill(EMERALD_BG);
      doc.roundedRect(feePanelX + 4, y + 23, 18, 4.8, 1.2, 1.2, "F");
      setText(EMERALD);
      doc.setFontSize(5.8);
      doc.text(`${discount}% SAVING`, feePanelX + 13, y + 26.3, { align: "center" });
    }

    if (program.intakes) {
      setText(MUTED);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(5.8);
      doc.text("INTAKE", feePanelX + 4, y + height - 8);
      setText(accent);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.5);
      doc.text(
        fitText(proposalPdfText(program.intakes), feePanelW - 21),
        feePanelX + feePanelW - 4,
        y + height - 8,
        { align: "right" },
      );
    }

    const detailY = y + height - 8;
    setDraw(BORDER);
    doc.setLineWidth(0.2);
    doc.line(infoX, detailY - 4.5, feePanelX - 5, detailY - 4.5);

    const detailCells: Array<{ label: string; value: string }> = [
      { label: "Application fee", value: fmt(program.applicationFee ?? 0, currency) },
    ];
    if (serviceFee != null) {
      detailCells.push({ label: "Service fee", value: fmt(serviceFee, currency) });
    }
    if (program.scholarship != null && program.scholarship > 0 && !hasDiscount) {
      detailCells.push({ label: "Scholarship", value: fmt(program.scholarship, currency) });
    }

    const availableW = feePanelX - infoX - 5;
    const detailCellW = availableW / detailCells.length;
    detailCells.forEach((detail, detailIndex) => {
      const detailX = infoX + detailIndex * detailCellW;
      if (detailIndex > 0) {
        setDraw(BORDER);
        doc.line(detailX - 2, detailY - 2.8, detailX - 2, detailY + 4);
      }
      setText(SUBTLE);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(5.6);
      doc.text(detail.label.toUpperCase(), detailX, detailY);
      setText(NAVY);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.text(fitText(detail.value, detailCellW - 4), detailX, detailY + 4);
    });
  }

  function drawFooter(pageNumber: number, totalPages: number) {
    setDraw(BORDER);
    doc.setLineWidth(0.25);
    doc.line(marginX, footerLineY, pageW - marginX, footerLineY);
    setText(SUBTLE);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6);
    doc.text(fitText(proposalPdfText(companyName), 62), marginX, footerLineY + 4);
    doc.text("Fees and availability are subject to university confirmation.", pageW / 2, footerLineY + 4, {
      align: "center",
    });
    setText(accent);
    doc.setFont("helvetica", "bold");
    doc.text(`${pageNumber} / ${totalPages}`, pageW - marginX, footerLineY + 4, { align: "right" });
  }

  drawHeader(false);
  drawSectionIntro();
  let y = contentStartY;

  programs.forEach((program, index) => {
    const height = cardHeight(program);
    if (y + height > footerLineY - 3) {
      doc.addPage();
      drawHeader(true);
      drawSectionIntro();
      y = contentStartY;
    }
    drawProgramCard(program, index, marginX, y, height);
    y += height + cardGap;
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
  const safeName = proposalPdfText(options.companyName || "Find And Study")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_-]/g, "") || "Proposal";
  doc.save(`${safeName}_Program_Proposal_${date.replace(/\./g, "-")}_${time.replace(":", "-")}.pdf`);
}
