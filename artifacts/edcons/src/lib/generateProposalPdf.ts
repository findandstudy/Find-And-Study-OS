import jsPDF from "jspdf";

type ProgramData = {
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

type ProposalOptions = {
  programs: ProgramData[];
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
};

function fmt(amount: number | null | undefined, currency = "USD"): string {
  if (amount == null) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `$${amount.toLocaleString()}`;
  }
}

async function loadImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url);
    const blob = await resp.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function detectImageFormat(dataUrl: string): string {
  if (dataUrl.includes("image/jpeg") || dataUrl.includes("image/jpg")) return "JPEG";
  if (dataUrl.includes("image/png")) return "PNG";
  if (dataUrl.includes("image/webp")) return "WEBP";
  if (dataUrl.includes("image/gif")) return "GIF";
  return "PNG";
}

function getTurkeyDateTime(): { date: string; time: string } {
  const now = new Date();
  const turkeyDate = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul",
    day: "2-digit", month: "2-digit", year: "numeric"
  }).format(now);
  const turkeyTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul",
    hour: "2-digit", minute: "2-digit", hour12: false
  }).format(now);
  return { date: turkeyDate.replace(/\//g, "-"), time: turkeyTime };
}

const BLUE        = [41,  98,  255] as const;
const BLUE_MID    = [37,  99,  235] as const;
const BLUE_DARK   = [30,  64,  175] as const;
const NAVY        = [15,  23,  42 ] as const;
const NAVY_HDR    = [17,  24,  39 ] as const;

function hexToRgb(hex: string): readonly [number, number, number] | null {
  const clean = hex.replace(/^#/, "");
  if (clean.length !== 6) return null;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
  return [r, g, b];
}
const DARK        = [30,  41,  59 ] as const;
const BODY        = [71,  85,  105] as const;
const SUBTLE      = [148, 163, 184] as const;
const BORDER      = [226, 232, 240] as const;
const LIGHT_BG    = [248, 250, 252] as const;
const WHITE       = [255, 255, 255] as const;
const EMERALD     = [16,  185, 129] as const;
const EMERALD_BG  = [209, 250, 229] as const;
const AMBER       = [245, 158, 11 ] as const;
const TEAL        = [20,  184, 166] as const;
const PURPLE      = [139, 92,  246] as const;
const SLATE       = [100, 116, 139] as const;
const LIGHT_BLUE_BG = [239, 246, 255] as const;
const BLUE_BANNER = [219, 234, 254] as const;

export async function generateProposalPdf(options: ProposalOptions) {
  const {
    programs,
    logoDataUrl,
    companyName = "Find And Study",
    companyEmail,
    companyPhone,
    companyWebsite,
    hideServiceFee = false,
    serviceFeeMarkup = 0,
    accentColor,
  } = options;

  const ACCENT: readonly [number, number, number] = (accentColor && hexToRgb(accentColor)) || BLUE_DARK;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = 210;
  const pageH = 297;
  const mx = 14;
  const cw = pageW - mx * 2;
  const colGap = 4;
  const cardW = (cw - colGap) / 2;
  const { date: dateStr, time: timeStr } = getTurkeyDateTime();

  const HEADER_H = 38;
  const BANNER_H = 13;
  const CONTENT_START = HEADER_H + BANNER_H + 4;
  const FOOTER_Y = pageH - 11;

  const uniLogos = new Map<string, string | null>();
  const uniLogoUrls = [...new Set(programs.filter(p => p.universityLogoUrl).map(p => p.universityLogoUrl!))];
  await Promise.all(uniLogoUrls.map(async (url) => {
    uniLogos.set(url, await loadImageAsDataUrl(url));
  }));

  function rgb(c: readonly number[]) { return c as [number, number, number]; }
  function setC(c: readonly number[]) { doc.setTextColor(c[0], c[1], c[2]); }
  function setF(c: readonly number[]) { doc.setFillColor(c[0], c[1], c[2]); }
  function setD(c: readonly number[]) { doc.setDrawColor(c[0], c[1], c[2]); }

  function drawGradientRect(x: number, y: number, w: number, h: number, fromC: readonly number[], toC: readonly number[]) {
    const steps = Math.ceil(h * 3);
    for (let s = 0; s < steps; s++) {
      const t = s / (steps - 1);
      const r = Math.round(fromC[0] + (toC[0] - fromC[0]) * t);
      const g = Math.round(fromC[1] + (toC[1] - fromC[1]) * t);
      const b = Math.round(fromC[2] + (toC[2] - fromC[2]) * t);
      doc.setFillColor(r, g, b);
      doc.rect(x, y + (s / steps) * h, w, h / steps + 0.1, "F");
    }
  }

  function drawHeader(isFirst: boolean) {
    drawGradientRect(0, 0, pageW, HEADER_H, NAVY_HDR, ACCENT);

    setF(AMBER);
    doc.rect(0, HEADER_H - 1.2, pageW, 1.2, "F");

    const logoSize = 20;
    const logoPad = 3;
    let textX = mx + logoPad;

    if (logoDataUrl) {
      const logoX = mx;
      const logoY = (HEADER_H - logoSize) / 2;
      setF(WHITE);
      doc.roundedRect(logoX - 1, logoY - 1, logoSize + 2, logoSize + 2, 2, 2, "F");
      try {
        doc.addImage(logoDataUrl, detectImageFormat(logoDataUrl), logoX, logoY, logoSize, logoSize);
      } catch {}
      textX = logoX + logoSize + 4;
    }

    setC(WHITE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text(companyName, textX, 13);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(147, 197, 253);
    doc.text(isFirst ? "Program Proposal" : "Program Proposal (continued)", textX, 20);

    const contactParts: string[] = [];
    if (companyPhone) contactParts.push(companyPhone);
    if (companyEmail) contactParts.push(companyEmail);
    if (companyWebsite) contactParts.push(companyWebsite);
    if (contactParts.length > 0) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      doc.setTextColor(186, 230, 253);
      doc.text(contactParts.join("  |  "), pageW - mx, 26, { align: "right" });
    }

    setC(WHITE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.text(`${dateStr}  ${timeStr}`, pageW - mx, 13, { align: "right" });
  }

  function drawIntroBanner(count: number) {
    const y = HEADER_H;
    setF(LIGHT_BLUE_BG);
    doc.rect(0, y, pageW, BANNER_H, "F");
    setF(BLUE_BANNER);
    doc.rect(0, y, pageW, 0.5, "F");
    doc.rect(0, y + BANNER_H - 0.5, pageW, 0.5, "F");

    setC(BLUE_DARK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(
      `${count} program${count !== 1 ? "s" : ""} curated for your review`,
      mx + 2,
      y + 8.5
    );

    setF(ACCENT);
    const chevX = pageW - mx - 16;
    const chevY = y + BANNER_H / 2 - 2;
    for (let sq = 0; sq < 3; sq++) {
      doc.roundedRect(chevX + sq * 5, chevY, 3.5, 3.5, 0.5, 0.5, "F");
    }
  }

  function drawFooter(pageNum: number, totalPages: number) {
    setD(BORDER);
    doc.setLineWidth(0.3);
    doc.line(mx, FOOTER_Y, pageW - mx, FOOTER_Y);

    setC(SUBTLE);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.text(companyName, mx, FOOTER_Y + 4);

    setC(BODY);
    doc.text(`${dateStr}  ${timeStr}`, pageW / 2, FOOTER_Y + 4, { align: "center" });

    setC(ACCENT);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.text(`Page ${pageNum} of ${totalPages}`, pageW - mx, FOOTER_Y + 4, { align: "right" });
  }

  function calcCardHeight(p: ProgramData, showServiceFee: boolean): number {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    const nameLines = Math.min(doc.splitTextToSize(p.name, cardW - 20).length, 2);
    const hasDiscount = p.discountedFee != null && p.tuitionFee != null && p.discountedFee < p.tuitionFee;
    const hasScholarship = p.scholarship != null && p.scholarship > 0;

    let rowCount = 1;
    if (hasScholarship && !hasDiscount) rowCount++;
    if (p.applicationFee && p.applicationFee > 0) rowCount++;
    if (showServiceFee) rowCount++;
    if (p.intakes) rowCount++;

    const TOP_SECTION_H = 19 + (nameLines - 1) * 4.5;
    const BADGES_H = 8;
    const DIVIDER_H = 5;
    const FEES_H = rowCount * 6.5;
    const BOTTOM_BAR_H = 3;
    const PADDING = 5;

    return TOP_SECTION_H + BADGES_H + DIVIDER_H + FEES_H + BOTTOM_BAR_H + PADDING;
  }

  function drawCard(p: ProgramData, cardX: number, cardY: number, cardIndex: number, showServiceFee: boolean) {
    const cur = p.currency ?? "USD";
    const hasDiscount = p.discountedFee != null && p.tuitionFee != null && p.discountedFee < p.tuitionFee;
    const hasScholarship = p.scholarship != null && p.scholarship > 0;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    const nameLines = Math.min(doc.splitTextToSize(p.name, cardW - 20).length, 2);
    const TOP_H = 19 + (nameLines - 1) * 4.5;

    const cardH = calcCardHeight(p, showServiceFee);
    const cardRight = cardX + cardW;
    const innerRight = cardRight - 4;
    const innerLeft = cardX + 4;

    setF(WHITE);
    doc.setDrawColor(220, 228, 240);
    doc.setLineWidth(0.15);
    doc.setFillColor(210, 220, 235);
    doc.roundedRect(cardX + 0.5, cardY + 0.6, cardW, cardH, 3, 3, "F");

    setF(WHITE);
    doc.roundedRect(cardX, cardY, cardW, cardH, 3, 3, "F");
    setD(BORDER);
    doc.setLineWidth(0.18);
    doc.roundedRect(cardX, cardY, cardW, cardH, 3, 3, "S");

    drawGradientRect(cardX, cardY, cardW, TOP_H, [22, 30, 55], ACCENT);
    setF([22, 30, 55]);
    doc.rect(cardX, cardY, cardW, 3, "F");
    setF(ACCENT);
    doc.rect(cardX, cardY + TOP_H - 3, cardW, 3, "F");

    const logoSize = 11;
    const logoX = innerLeft;
    const logoY = cardY + 4;

    if (p.universityLogoUrl && uniLogos.get(p.universityLogoUrl)) {
      try {
        const uld = uniLogos.get(p.universityLogoUrl)!;
        setF(WHITE);
        doc.roundedRect(logoX - 0.8, logoY - 0.8, logoSize + 1.6, logoSize + 1.6, 1.5, 1.5, "F");
        doc.addImage(uld, detectImageFormat(uld), logoX, logoY, logoSize, logoSize);
      } catch {
        setF([40, 60, 120]);
        doc.roundedRect(logoX, logoY, logoSize, logoSize, 1.5, 1.5, "F");
      }
    } else {
      setF([40, 60, 120]);
      doc.roundedRect(logoX, logoY, logoSize, logoSize, 1.5, 1.5, "F");
    }

    const badgeText = `${cardIndex + 1}`;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(5.5);
    const badgeW = doc.getTextWidth(badgeText) + 4;
    const badgeX = logoX + logoSize - badgeW + 1;
    const badgeY = logoY - 3.5;
    setF(ACCENT);
    doc.roundedRect(badgeX, badgeY, badgeW, 4, 1, 1, "F");
    setC(WHITE);
    doc.text(badgeText, badgeX + badgeW / 2, badgeY + 2.9, { align: "center" });

    const nameX = logoX + logoSize + 3;
    const nameMaxW = cardRight - 4 - nameX;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6);
    doc.setTextColor(147, 197, 253);
    const uniNameTrunc = doc.splitTextToSize(p.universityName, nameMaxW)[0] as string;
    doc.text(uniNameTrunc, nameX, logoY + 4.5);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    setC(WHITE);
    const pNameLines = doc.splitTextToSize(p.name, nameMaxW) as string[];
    for (let nl = 0; nl < Math.min(pNameLines.length, 2); nl++) {
      doc.text(pNameLines[nl], nameX, logoY + 9 + nl * 4.5);
    }

    let iy = cardY + TOP_H + 3;

    const badgesDef: Array<{ text: string; fill: readonly number[]; textC: readonly number[] }> = [];
    if (p.degree)          badgesDef.push({ text: p.degree,          fill: [37, 99, 235],  textC: WHITE });
    if (p.language)        badgesDef.push({ text: p.language,        fill: [100, 116, 139], textC: WHITE });
    if (p.duration)        badgesDef.push({ text: p.duration,        fill: [107, 114, 128], textC: WHITE });
    if (p.universityType)  badgesDef.push({ text: p.universityType,  fill: [124, 58, 237],  textC: WHITE });
    if (p.universityCity)  badgesDef.push({ text: p.universityCity,  fill: [15, 158, 142],  textC: WHITE });

    let bx = innerLeft;
    const badgeH = 4.5;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(5.5);
    for (const bd of badgesDef) {
      const bw = doc.getTextWidth(bd.text) + 4;
      if (bx + bw > innerRight) break;
      setF(bd.fill);
      doc.roundedRect(bx, iy, bw, badgeH, 1, 1, "F");
      setC(bd.textC);
      doc.text(bd.text, bx + 2, iy + 3.2);
      bx += bw + 2;
    }

    iy += badgeH + 3.5;

    setD(BORDER);
    doc.setLineWidth(0.15);
    doc.line(innerLeft, iy, innerRight, iy);
    iy += 4;

    function drawFeeRow(label: string, value: string, lc: readonly number[], vc: readonly number[], bold = true) {
      setC(lc);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.text(label, innerLeft, iy);
      setC(vc);
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(7);
      doc.text(value, innerRight, iy, { align: "right" });
      iy += 6.5;
    }

    const feeLabel = "Tuition Fee" + (p.feeType ? ` (${p.feeType})` : "");

    if (hasDiscount) {
      setC(SLATE);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.text(feeLabel, innerLeft, iy);

      if (hasScholarship) {
        const pct = p.tuitionFee && p.tuitionFee > 0
          ? Math.round((p.scholarship! / p.tuitionFee) * 100)
          : 0;
        if (pct > 0) {
          const pctText = `${pct}% off`;
          doc.setFont("helvetica", "bold");
          doc.setFontSize(5.5);
          const pw = doc.getTextWidth(pctText) + 4;
          const px = innerLeft + doc.getTextWidth(feeLabel) + 2;
          setF(EMERALD_BG);
          doc.roundedRect(px, iy - 3.5, pw, 4.2, 1, 1, "F");
          setC(EMERALD);
          doc.text(pctText, px + 2, iy - 0.3);
        }
      }

      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      setC(SUBTLE);
      const oldFee = fmt(p.tuitionFee, cur);
      const oldX = innerRight - 18;
      const oldW = doc.getTextWidth(oldFee);
      doc.text(oldFee, oldX, iy, { align: "right" });
      setD(SUBTLE);
      doc.setLineWidth(0.3);
      doc.line(oldX - oldW, iy - 1.2, oldX, iy - 1.2);

      setC(EMERALD);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text(fmt(p.discountedFee, cur), innerRight, iy, { align: "right" });
      iy += 6.5;
    } else {
      drawFeeRow(feeLabel, fmt(p.tuitionFee, cur), SLATE, NAVY);
    }

    if (hasScholarship && !hasDiscount) {
      drawFeeRow("Scholarship", fmt(p.scholarship, cur), EMERALD, EMERALD);
    }

    if (p.applicationFee && p.applicationFee > 0) {
      drawFeeRow("Application Fee", fmt(p.applicationFee, cur), SLATE, DARK);
    }

    if (showServiceFee) {
      const totalSF = Math.max(0, (p.serviceFeeAmount ?? 0) + serviceFeeMarkup);
      drawFeeRow("Service Fee", fmt(totalSF, cur), SLATE, DARK);
    }

    if (p.intakes) {
      setC(BODY);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.text("Intakes", innerLeft, iy);
      setC(ACCENT);
      doc.setFont("helvetica", "bold");
      doc.text(p.intakes, innerRight, iy, { align: "right" });
      iy += 6.5;
    }

    setF(NAVY);
    doc.rect(cardX, cardY + cardH - 2, cardW, 2, "F");

    setF([22, 30, 55]);
    doc.rect(cardX, cardY + cardH - 2, 3, 2, "F");
    doc.rect(cardX + cardW - 3, cardY + cardH - 2, 3, 2, "F");
  }

  drawHeader(true);
  drawIntroBanner(programs.length);

  let cy = CONTENT_START;

  for (let rowStart = 0; rowStart < programs.length; rowStart += 2) {
    const leftP = programs[rowStart];
    const rightP = programs[rowStart + 1] ?? null;

    const leftSF = !hideServiceFee && ((leftP.serviceFeeAmount ?? 0) + serviceFeeMarkup) > 0;
    const rightSF = rightP ? (!hideServiceFee && ((rightP.serviceFeeAmount ?? 0) + serviceFeeMarkup) > 0) : false;

    const leftH = calcCardHeight(leftP, leftSF);
    const rightH = rightP ? calcCardHeight(rightP, rightSF) : 0;
    const rowH = Math.max(leftH, rightH);

    if (cy + rowH + 2 > FOOTER_Y - 2) {
      doc.addPage();
      drawHeader(false);
      cy = CONTENT_START;
    }

    drawCard(leftP, mx, cy, rowStart, leftSF);
    if (rightP) {
      drawCard(rightP, mx + cardW + colGap, cy, rowStart + 1, rightSF);
    }

    cy += rowH + 5;
  }

  const totalPages = doc.getNumberOfPages();
  for (let pg = 1; pg <= totalPages; pg++) {
    doc.setPage(pg);
    drawFooter(pg, totalPages);
  }

  const fileName = `${companyName.replace(/\s+/g, "_")}_Proposal_${dateStr}_${timeStr.replace(":", "-")}.pdf`;
  doc.save(fileName);
}
