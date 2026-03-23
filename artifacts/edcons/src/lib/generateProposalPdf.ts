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
  serviceFeeMarkup?: number;
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

const PRIMARY = [22, 78, 99];
const PRIMARY_DARK = [15, 52, 67];
const ACCENT_GOLD = [180, 142, 58];
const DARK = [20, 20, 30];
const BODY = [55, 65, 81];
const SUBTLE = [140, 150, 165];
const BORDER_LIGHT = [220, 225, 232];
const CARD_BG = [248, 249, 252];
const WHITE = [255, 255, 255];
const GREEN = [16, 140, 90];

function drawRoundedRect(doc: jsPDF, x: number, y: number, w: number, h: number, r: number, fillColor: number[]) {
  doc.setFillColor(fillColor[0], fillColor[1], fillColor[2]);
  doc.roundedRect(x, y, w, h, r, r, "F");
}

function drawLine(doc: jsPDF, x1: number, y1: number, x2: number, y2: number, color: number[], width = 0.3) {
  doc.setDrawColor(color[0], color[1], color[2]);
  doc.setLineWidth(width);
  doc.line(x1, y1, x2, y2);
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

export async function generateProposalPdf(options: ProposalOptions) {
  const { programs, logoDataUrl, companyName = "Find And Study", companyEmail, companyPhone, companyWebsite, showCommission = false, serviceFeeMarkup = 0 } = options;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = 210;
  const pageH = 297;
  const margin = 16;
  const contentW = pageW - margin * 2;
  const { date: dateStr, time: timeStr } = getTurkeyDateTime();

  const uniLogos = new Map<string, string | null>();
  const uniLogoUrls = [...new Set(programs.filter(p => p.universityLogoUrl).map(p => p.universityLogoUrl!))];
  await Promise.all(
    uniLogoUrls.map(async (url) => {
      const dataUrl = await loadImageAsDataUrl(url);
      uniLogos.set(url, dataUrl);
    })
  );

  function drawHeader(isFirst: boolean) {
    doc.setFillColor(PRIMARY[0], PRIMARY[1], PRIMARY[2]);
    doc.rect(0, 0, pageW, 38, "F");

    doc.setFillColor(PRIMARY_DARK[0], PRIMARY_DARK[1], PRIMARY_DARK[2]);
    doc.rect(0, 38, pageW, 1.5, "F");

    let logoX = margin;
    if (logoDataUrl) {
      try {
        doc.addImage(logoDataUrl, detectImageFormat(logoDataUrl), margin, 6, 24, 24);
        logoX = margin + 28;
      } catch {
        logoX = margin;
      }
    }

    doc.setTextColor(WHITE[0], WHITE[1], WHITE[2]);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text(companyName, logoX, 18);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(200, 220, 230);
    doc.text(isFirst ? "Program Proposal" : "Program Proposal (cont.)", logoX, 24);

    const contactLines: string[] = [];
    if (companyEmail) contactLines.push(companyEmail);
    if (companyPhone) contactLines.push(companyPhone);
    if (companyWebsite) contactLines.push(companyWebsite);

    doc.setTextColor(200, 220, 230);
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    contactLines.forEach((txt, i) => {
      doc.text(txt, pageW - margin, 12 + i * 4, { align: "right" });
    });

    const dateTimeY = 12 + contactLines.length * 4 + 2;
    doc.setTextColor(ACCENT_GOLD[0], ACCENT_GOLD[1], ACCENT_GOLD[2]);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.text(`${dateStr}  ${timeStr}`, pageW - margin, dateTimeY, { align: "right" });
  }

  function drawFooter(pageNum: number, totalPages: number) {
    const footerY = pageH - 8;
    drawLine(doc, margin, footerY - 4, pageW - margin, footerY - 4, BORDER_LIGHT, 0.4);

    if (serviceFeeMarkup > 0) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(6);
      doc.setTextColor(SUBTLE[0], SUBTLE[1], SUBTLE[2]);
      doc.text("* Fees may include agency-applied service adjustments.", margin, footerY - 7);
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(SUBTLE[0], SUBTLE[1], SUBTLE[2]);
    doc.text(`${companyName}  |  Confidential`, margin, footerY);
    doc.text(`Page ${pageNum} / ${totalPages}`, pageW - margin, footerY, { align: "right" });
  }

  let currentY = 47;
  let pageCount = 1;

  drawHeader(true);

  doc.setTextColor(DARK[0], DARK[1], DARK[2]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Selected Programs", margin, currentY);

  currentY += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(SUBTLE[0], SUBTLE[1], SUBTLE[2]);
  doc.text(`${programs.length} program${programs.length !== 1 ? "s" : ""} curated for your review`, margin, currentY);

  currentY += 5;
  doc.setFillColor(ACCENT_GOLD[0], ACCENT_GOLD[1], ACCENT_GOLD[2]);
  doc.rect(margin, currentY, 30, 0.8, "F");
  doc.setFillColor(BORDER_LIGHT[0], BORDER_LIGHT[1], BORDER_LIGHT[2]);
  doc.rect(margin + 30, currentY, contentW - 30, 0.3, "F");
  currentY += 7;

  for (let i = 0; i < programs.length; i++) {
    const p = programs[i];
    const cur = p.currency ?? "USD";
    const hasDiscount = p.discountedFee != null && p.tuitionFee != null && p.discountedFee < p.tuitionFee;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    const preCalcLines = Math.min(doc.splitTextToSize(p.name, contentW - 42).length, 2);
    const preCalcServiceFee = (p.serviceFeeAmount ?? 0) + serviceFeeMarkup;
    let cardH = 55 + (preCalcLines - 1) * 4.5;
    if (p.scholarship && p.scholarship > 0) cardH += 6;
    if (p.applicationFee && p.applicationFee > 0) cardH += 6;
    if (preCalcServiceFee > 0) cardH += 6;

    if (currentY + cardH > pageH - 18) {
      pageCount++;
      doc.addPage();
      drawHeader(false);
      currentY = 47;
    }

    drawRoundedRect(doc, margin, currentY, contentW, cardH, 2.5, CARD_BG);

    doc.setFillColor(PRIMARY[0], PRIMARY[1], PRIMARY[2]);
    doc.roundedRect(margin, currentY, 2.5, cardH, 1.2, 1.2, "F");

    const innerX = margin + 8;
    let innerY = currentY + 7;

    drawRoundedRect(doc, innerX, currentY + 3, 14, 5.5, 1.5, PRIMARY);
    doc.setTextColor(WHITE[0], WHITE[1], WHITE[2]);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.text(`#${i + 1}`, innerX + 7, currentY + 7, { align: "center" });

    const nameX = innerX + 18;

    if (p.universityLogoUrl && uniLogos.get(p.universityLogoUrl)) {
      try {
        const uniLogoData = uniLogos.get(p.universityLogoUrl)!;
        doc.addImage(uniLogoData, detectImageFormat(uniLogoData), nameX - 1, currentY + 2.5, 7, 7);
      } catch {}
    }

    const textStartX = (p.universityLogoUrl && uniLogos.get(p.universityLogoUrl)) ? nameX + 9 : nameX;

    doc.setTextColor(SUBTLE[0], SUBTLE[1], SUBTLE[2]);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text(p.universityName, textStartX, innerY - 2);

    doc.setTextColor(DARK[0], DARK[1], DARK[2]);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    const maxNameW = margin + contentW - 8 - textStartX;
    const programName = doc.splitTextToSize(p.name, maxNameW) as string[];
    const nameLines = Math.min(programName.length, 2);
    for (let nl = 0; nl < nameLines; nl++) {
      doc.text(programName[nl], textStartX, innerY + 3 + nl * 4.5);
    }

    innerY += 5 + (nameLines - 1) * 4.5;

    const badges: string[] = [];
    if (p.degree) badges.push(p.degree);
    if (p.language) badges.push(p.language);
    if (p.duration) badges.push(p.duration);
    if (p.universityCountry) badges.push(p.universityCountry);
    if (p.universityCity) badges.push(p.universityCity);

    let bx = innerX;
    badges.forEach(badge => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      const tw = doc.getTextWidth(badge) + 5;
      doc.setFillColor(230, 235, 242);
      doc.roundedRect(bx, innerY, tw, 5, 1, 1, "F");
      doc.setTextColor(PRIMARY[0], PRIMARY[1], PRIMARY[2]);
      doc.text(badge, bx + 2.5, innerY + 3.5);
      bx += tw + 2;
    });

    innerY += 10;
    drawLine(doc, innerX, innerY, margin + contentW - 8, innerY, BORDER_LIGHT, 0.3);
    innerY += 5;

    const col1 = innerX;
    const colVal = margin + contentW - 8;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(BODY[0], BODY[1], BODY[2]);
    doc.text("Tuition Fee" + (p.feeType ? ` (${p.feeType})` : ""), col1, innerY);
    if (hasDiscount) {
      doc.setTextColor(SUBTLE[0], SUBTLE[1], SUBTLE[2]);
      doc.setFont("helvetica", "normal");
      const oldFee = fmt(p.tuitionFee, cur);
      const oldFeeW = doc.getTextWidth(oldFee);
      doc.text(oldFee, colVal - 30, innerY, { align: "right" });
      doc.setLineWidth(0.25);
      doc.setDrawColor(SUBTLE[0], SUBTLE[1], SUBTLE[2]);
      doc.line(colVal - 30 - oldFeeW, innerY - 1, colVal - 30, innerY - 1);

      doc.setFont("helvetica", "bold");
      doc.setTextColor(GREEN[0], GREEN[1], GREEN[2]);
      doc.text(fmt(p.discountedFee, cur), colVal, innerY, { align: "right" });
    } else {
      doc.setFont("helvetica", "bold");
      doc.setTextColor(DARK[0], DARK[1], DARK[2]);
      doc.text(fmt(p.tuitionFee, cur), colVal, innerY, { align: "right" });
    }
    innerY += 6;

    if (p.scholarship && p.scholarship > 0) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(GREEN[0], GREEN[1], GREEN[2]);
      doc.text("Scholarship", col1, innerY);
      doc.setFont("helvetica", "bold");
      doc.text(fmt(p.scholarship, cur), colVal, innerY, { align: "right" });
      innerY += 6;
    }

    if (p.applicationFee && p.applicationFee > 0) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(BODY[0], BODY[1], BODY[2]);
      doc.text("Application Fee", col1, innerY);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(DARK[0], DARK[1], DARK[2]);
      doc.text(fmt(p.applicationFee, cur), colVal, innerY, { align: "right" });
      innerY += 6;
    }

    const rawServiceFee = p.serviceFeeAmount ?? 0;
    const adjustedServiceFee = rawServiceFee + serviceFeeMarkup;
    if (adjustedServiceFee > 0) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(BODY[0], BODY[1], BODY[2]);
      doc.text("Service Fee", col1, innerY);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(DARK[0], DARK[1], DARK[2]);
      doc.text(fmt(adjustedServiceFee, cur), colVal, innerY, { align: "right" });
      innerY += 6;
    }

    if (p.intakes) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(BODY[0], BODY[1], BODY[2]);
      doc.text("Intakes", col1, innerY);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(DARK[0], DARK[1], DARK[2]);
      doc.text(p.intakes, colVal, innerY, { align: "right" });
    }

    currentY += cardH + 5;
  }

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    drawFooter(i, totalPages);
  }

  const fileName = `${companyName.replace(/\s+/g, "_")}_Proposal_${dateStr}_${timeStr.replace(":", "-")}.pdf`;
  doc.save(fileName);
}
