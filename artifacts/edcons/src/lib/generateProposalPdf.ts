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
const RED: Rgb = [220, 38, 38];
const RED_BG: Rgb = [254, 242, 242];
const DEFAULT_ACCENT: Rgb = [30, 64, 175];

type Column = {
  key: "program" | "degree" | "location" | "language" | "fees" | "availability";
  label: string;
  width: number;
};

const COLUMNS: Column[] = [
  { key: "program", label: "PROGRAM DETAILS", width: 54 },
  { key: "degree", label: "DEGREE", width: 21 },
  { key: "location", label: "LOCATION", width: 27 },
  { key: "language", label: "LANGUAGE", width: 19 },
  { key: "fees", label: "FEES", width: 39 },
  { key: "availability", label: "INTAKE / STATUS", width: 26 },
];

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
 * Normalise the only bitmap in the proposal - the preparing organisation's
 * logo - before it reaches jsPDF. University logos are deliberately omitted
 * from the comparison table to keep multi-page WhatsApp attachments small.
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
  const tableStartY = 51;
  const tableHeaderH = 9;
  const footerLineY = pageH - 11;
  const rowBottomLimit = footerLineY - 3;
  const { date: dateStr, time: timeStr } = getProposalDateTime(generatedAt);

  const companyLogo = logoDataUrl
    ? await (async () => {
        try {
          const response = await fetch(logoDataUrl);
          if (response.ok) return compressLogoBlob(await response.blob(), 240, 0.78);
        } catch {
          // A data URL can still be passed directly if browser compression fails.
        }
        return logoDataUrl;
      })()
    : null;

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

  function split(value: unknown, maxWidth: number, maxLines: number): string[] {
    const lines = doc.splitTextToSize(proposalPdfText(value), maxWidth) as string[];
    if (lines.length <= maxLines) return lines;
    const visible = lines.slice(0, maxLines);
    visible[maxLines - 1] = fitText(`${visible[maxLines - 1]}...`, maxWidth);
    return visible;
  }

  function drawCompanyLogo(x: number, y: number, size: number) {
    setFill(WHITE);
    setDraw(BORDER);
    doc.setLineWidth(0.2);
    doc.roundedRect(x, y, size, size, 1.8, 1.8, "FD");
    if (!companyLogo) {
      setFill(accentSoft);
      doc.roundedRect(x + 1.2, y + 1.2, size - 2.4, size - 2.4, 1.2, 1.2, "F");
      setText(accent);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(
        proposalPdfText(companyName).trim().slice(0, 1).toUpperCase() || "F",
        x + size / 2,
        y + size / 2 + 2,
        { align: "center" },
      );
      return;
    }
    try {
      doc.addImage(
        companyLogo,
        dataUrlFormat(companyLogo),
        x + 0.7,
        y + 0.7,
        size - 1.4,
        size - 1.4,
        "proposal-company-logo",
        "FAST",
      );
    } catch {
      // A malformed remote logo must never block proposal creation.
    }
  }

  function drawHeader() {
    const logoSize = 16;
    const logoX = marginX;
    const logoY = 8;
    drawCompanyLogo(logoX, logoY, logoSize);

    const titleX = logoX + logoSize + 4;
    setText(NAVY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12.5);
    doc.text(fitText(companyName, 87), titleX, 13.5);

    setText(MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text("Comprehensive Programs Proposal", titleX, 19);
    setText(SUBTLE);
    doc.setFontSize(6.2);
    doc.text(`${programs.length} selected program${programs.length === 1 ? "" : "s"}`, titleX, 23);

    const stampW = 52;
    const stampH = 17;
    const stampX = pageW - marginX - stampW;
    const stampY = 8;
    setFill(LIGHT_BG);
    doc.roundedRect(stampX, stampY, stampW, stampH, 2, 2, "F");
    setText(MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.8);
    doc.text("PREPARED", stampX + 4, stampY + 5);
    setText(NAVY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.2);
    doc.text(`${dateStr}  ${timeStr}`, stampX + 4, stampY + 10.5);
    setText(SUBTLE);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.4);
    doc.text("Europe/Istanbul", stampX + 4, stampY + 14.5);

    setDraw(BORDER);
    doc.setLineWidth(0.25);
    doc.line(marginX, 29, pageW - marginX, 29);

    const contacts = [
      companyPhone ? `Phone  ${proposalPdfText(companyPhone)}` : "",
      companyEmail ? `Email  ${proposalPdfText(companyEmail)}` : "",
      companyWebsite ? `Web  ${compactWebsite(companyWebsite)}` : "",
    ].filter(Boolean);
    setFill(LIGHT_BG);
    doc.roundedRect(marginX, 33, contentW, 11, 2, 2, "F");
    if (contacts.length) {
      const cellW = contentW / contacts.length;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.4);
      contacts.forEach((contact, index) => {
        const x = marginX + index * cellW;
        if (index > 0) {
          setDraw(BORDER);
          doc.setLineWidth(0.2);
          doc.line(x, 35.5, x, 41.5);
        }
        setText(BODY);
        doc.text(fitText(contact, cellW - 6), x + 3, 39.8);
      });
    } else {
      setText(MUTED);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.4);
      doc.text("Prepared for student review", marginX + 3, 39.8);
    }
  }

  function drawTableHeader() {
    setFill(accent);
    doc.roundedRect(marginX, tableStartY, contentW, tableHeaderH, 2, 2, "F");
    // Square the lower corners so rows join the header cleanly.
    doc.rect(marginX, tableStartY + tableHeaderH - 2, contentW, 2, "F");
    let x = marginX;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(5.4);
    COLUMNS.forEach((column) => {
      setText(WHITE);
      doc.text(column.label, x + 2.4, tableStartY + 5.7);
      x += column.width;
    });
  }

  function programRowHeight(program: ProposalProgramData): number {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.2);
    const titleLines = Math.min(split(program.name, COLUMNS[0].width - 5, 2).length, 2);
    const feeLines =
      2 +
      (program.discountedFee != null &&
      program.tuitionFee != null &&
      program.discountedFee < program.tuitionFee
        ? 1
        : 0) +
      1 +
      (getProposalServiceFee(program, serviceFeeMarkup, hideServiceFee) != null ? 1 : 0);
    return Math.max(22, 9 + titleLines * 3.7, 8 + feeLines * 3.2);
  }

  function drawPill(
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    foreground: Rgb,
    background: Rgb,
  ) {
    const safe = fitText(text, maxWidth - 4);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(5.4);
    const width = Math.min(maxWidth, Math.max(10, doc.getTextWidth(safe) + 4));
    setFill(background);
    doc.roundedRect(x, y, width, 4.8, 1.6, 1.6, "F");
    setText(foreground);
    doc.text(safe, x + width / 2, y + 3.25, { align: "center" });
  }

  function drawProgramRow(program: ProposalProgramData, rowIndex: number, y: number, height: number) {
    const currency = program.currency || "USD";
    const effectiveTuition = program.discountedFee ?? program.tuitionFee;
    const hasDiscount =
      program.discountedFee != null &&
      program.tuitionFee != null &&
      program.discountedFee < program.tuitionFee;
    const serviceFee = getProposalServiceFee(program, serviceFeeMarkup, hideServiceFee);

    setFill(rowIndex % 2 === 0 ? WHITE : LIGHT_BG);
    doc.rect(marginX, y, contentW, height, "F");

    let x = marginX;
    setDraw(BORDER);
    doc.setLineWidth(0.15);
    COLUMNS.slice(0, -1).forEach((column) => {
      x += column.width;
      doc.line(x, y + 2, x, y + height - 2);
    });
    doc.line(marginX, y + height, marginX + contentW, y + height);

    // Program and university.
    x = marginX;
    setFill(accent);
    doc.circle(x + 3.1, y + 6.2, 1.2, "F");
    setText(NAVY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.2);
    const titleLines = split(program.name, COLUMNS[0].width - 8, 2);
    titleLines.forEach((line, index) => doc.text(line, x + 6, y + 5.4 + index * 3.7));
    const universityY = y + 7.1 + titleLines.length * 3.7;
    setText(MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.9);
    doc.text(fitText(program.universityName, COLUMNS[0].width - 8), x + 6, universityY);
    if (program.duration) {
      setText(SUBTLE);
      doc.setFontSize(5.3);
      doc.text(fitText(program.duration, COLUMNS[0].width - 8), x + 6, universityY + 3.3);
    }

    // Degree.
    x += COLUMNS[0].width;
    drawPill(program.degree || "-", x + 2.3, y + 4, COLUMNS[1].width - 4.6, accent, accentSoft);

    // Location.
    x += COLUMNS[1].width;
    setText(NAVY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.2);
    const city = program.universityCity || "-";
    doc.text(fitText(city, COLUMNS[2].width - 5), x + 2.4, y + 6);
    setText(MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.8);
    split(program.universityCountry || "-", COLUMNS[2].width - 5, 2).forEach((line, index) => {
      doc.text(line, x + 2.4, y + 10 + index * 3);
    });
    if (program.universityType) {
      setText(SUBTLE);
      doc.setFontSize(5.3);
      doc.text(fitText(program.universityType, COLUMNS[2].width - 5), x + 2.4, y + height - 3);
    }

    // Language.
    x += COLUMNS[2].width;
    setText(NAVY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.2);
    split(program.language || "-", COLUMNS[3].width - 5, 3).forEach((line, index) => {
      doc.text(line, x + 2.4, y + 6 + index * 3.3);
    });

    // Fees. Commission remains intentionally absent from student proposals.
    x += COLUMNS[3].width;
    setText(MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.1);
    doc.text("TUITION", x + 2.4, y + 4.5);
    setText(hasDiscount ? EMERALD : NAVY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.8);
    doc.text(fitText(fmt(effectiveTuition, currency), COLUMNS[4].width - 5), x + 2.4, y + 8.5);
    let feeY = y + 12;
    if (hasDiscount) {
      const original = fmt(program.tuitionFee, currency);
      setText(SUBTLE);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(5.3);
      doc.text(`Was ${original}`, x + 2.4, feeY);
      feeY += 3.1;
    }
    setText(BODY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.3);
    doc.text(
      fitText(`Application  ${feeOrFree(program.applicationFee, currency)}`, COLUMNS[4].width - 5),
      x + 2.4,
      feeY,
    );
    feeY += 3.1;
    if (serviceFee != null) {
      doc.text(
        fitText(`Service  ${fmt(serviceFee, currency)}`, COLUMNS[4].width - 5),
        x + 2.4,
        feeY,
      );
    }

    // Intake and status.
    x += COLUMNS[4].width;
    setText(MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.1);
    doc.text("INTAKE", x + 2.4, y + 4.5);
    setText(NAVY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.1);
    split(program.intakes || "-", COLUMNS[5].width - 5, 2).forEach((line, index) => {
      doc.text(line, x + 2.4, y + 8.5 + index * 3.2);
    });
    const status = proposalPdfText(program.universityStatus || "Open").toUpperCase();
    const isClosed = /CLOSED|INACTIVE/.test(status);
    drawPill(
      isClosed ? "CLOSED" : "OPEN",
      x + 2.4,
      y + height - 7.2,
      COLUMNS[5].width - 4.8,
      isClosed ? RED : EMERALD,
      isClosed ? RED_BG : EMERALD_BG,
    );
  }

  function closeTable(lastY: number) {
    setDraw(BORDER);
    doc.setLineWidth(0.25);
    doc.roundedRect(marginX, tableStartY, contentW, Math.max(tableHeaderH, lastY - tableStartY), 2, 2, "S");
  }

  function drawFooter(pageNumber: number, totalPages: number) {
    setDraw(BORDER);
    doc.setLineWidth(0.25);
    doc.line(marginX, footerLineY, pageW - marginX, footerLineY);
    setText(SUBTLE);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.7);
    const companyFooter = companyEmail
      ? `${proposalPdfText(companyName)}  |  ${proposalPdfText(companyEmail)}`
      : proposalPdfText(companyName);
    doc.text(fitText(companyFooter, 69), marginX, footerLineY + 4);
    doc.text("Fees and availability are subject to university confirmation.", pageW / 2, footerLineY + 4, {
      align: "center",
    });
    setText(accent);
    doc.setFont("helvetica", "bold");
    doc.text(`Page ${pageNumber} of ${totalPages}`, pageW - marginX, footerLineY + 4, { align: "right" });
  }

  drawHeader();
  drawTableHeader();
  let y = tableStartY + tableHeaderH;
  let rowIndex = 0;

  if (!programs.length) {
    setText(MUTED);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text("No programs were selected.", marginX + 5, y + 12);
    y += 20;
  } else {
    for (const program of programs) {
      const height = programRowHeight(program);
      if (y + height > rowBottomLimit) {
        closeTable(y);
        doc.addPage();
        drawHeader();
        drawTableHeader();
        y = tableStartY + tableHeaderH;
      }
      drawProgramRow(program, rowIndex, y, height);
      y += height;
      rowIndex += 1;
    }
  }
  closeTable(y);

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
