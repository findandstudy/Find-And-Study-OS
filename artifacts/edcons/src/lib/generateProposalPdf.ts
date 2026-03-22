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

function calcCommission(p: ProgramData): number | null {
  if (p.commissionRate == null) return null;
  const fee = p.discountedFee ?? p.tuitionFee;
  if (fee == null) return null;
  return Math.round((fee * p.commissionRate) / 100);
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

const PRIMARY = [30, 64, 175];
const PRIMARY_LIGHT = [239, 246, 255];
const DARK = [15, 23, 42];
const GRAY = [100, 116, 139];
const ACCENT = [16, 185, 129];
const WHITE = [255, 255, 255];

function drawRoundedRect(doc: jsPDF, x: number, y: number, w: number, h: number, r: number, fillColor: number[]) {
  doc.setFillColor(fillColor[0], fillColor[1], fillColor[2]);
  doc.roundedRect(x, y, w, h, r, r, "F");
}

function drawLine(doc: jsPDF, x1: number, y1: number, x2: number, y2: number, color: number[], width = 0.3) {
  doc.setDrawColor(color[0], color[1], color[2]);
  doc.setLineWidth(width);
  doc.line(x1, y1, x2, y2);
}

export async function generateProposalPdf(options: ProposalOptions) {
  const { programs, logoDataUrl, companyName = "EduCons", companyEmail, companyPhone, showCommission = false, serviceFeeMarkup = 0 } = options;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = 210;
  const pageH = 297;
  const margin = 15;
  const contentW = pageW - margin * 2;
  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const uniLogos = new Map<string, string | null>();
  const uniLogoUrls = [...new Set(programs.filter(p => p.universityLogoUrl).map(p => p.universityLogoUrl!))];
  await Promise.all(
    uniLogoUrls.map(async (url) => {
      const dataUrl = await loadImageAsDataUrl(url);
      uniLogos.set(url, dataUrl);
    })
  );

  function drawHeader(isFirst: boolean) {
    drawRoundedRect(doc, 0, 0, pageW, 42, 0, PRIMARY);

    doc.setFillColor(255, 255, 255, 15);
    doc.circle(pageW - 20, 10, 30, "F");
    doc.circle(pageW - 60, -10, 20, "F");

    let logoX = margin;
    if (logoDataUrl) {
      try {
        doc.addImage(logoDataUrl, detectImageFormat(logoDataUrl), margin, 8, 26, 26);
        logoX = margin + 30;
      } catch {
        logoX = margin;
      }
    }

    doc.setTextColor(WHITE[0], WHITE[1], WHITE[2]);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text(companyName, logoX, 20);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(isFirst ? "Program Proposal" : "Program Proposal (cont.)", logoX, 27);

    doc.setFontSize(8);
    const rightTexts: string[] = [date];
    if (companyEmail) rightTexts.push(companyEmail);
    if (companyPhone) rightTexts.push(companyPhone);
    rightTexts.forEach((txt, i) => {
      doc.text(txt, pageW - margin, 14 + i * 5, { align: "right" });
    });
  }

  function drawFooter(pageNum: number, totalPages: number) {
    const footerY = pageH - 10;
    drawLine(doc, margin, footerY - 3, pageW - margin, footerY - 3, [226, 232, 240]);
    doc.setTextColor(GRAY[0], GRAY[1], GRAY[2]);
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    if (serviceFeeMarkup > 0) {
      doc.setFont("helvetica", "italic");
      doc.text("Fees in this PDF may include agency-added service adjustments.", margin, footerY - 7);
      doc.setFont("helvetica", "normal");
    }
    doc.text(`${companyName} | Confidential`, margin, footerY);
    doc.text(`Page ${pageNum} of ${totalPages}`, pageW - margin, footerY, { align: "right" });
  }

  let currentY = 50;
  let pageCount = 1;

  drawHeader(true);

  currentY = 52;
  doc.setTextColor(DARK[0], DARK[1], DARK[2]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Selected Programs", margin, currentY);
  currentY += 3;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(GRAY[0], GRAY[1], GRAY[2]);
  doc.text(`${programs.length} program${programs.length !== 1 ? "s" : ""} selected for your review`, margin, currentY + 5);
  currentY += 12;

  drawLine(doc, margin, currentY, pageW - margin, currentY, PRIMARY, 0.6);
  currentY += 6;

  for (let i = 0; i < programs.length; i++) {
    const p = programs[i];
    const cur = p.currency ?? "USD";
    const hasDiscount = p.discountedFee != null && p.tuitionFee != null && p.discountedFee < p.tuitionFee;
    const commAmt = calcCommission(p);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    const preCalcLines = Math.min(doc.splitTextToSize(p.name, contentW - 40).length, 2);
    const preCalcServiceFee = (p.serviceFeeAmount ?? 0) + serviceFeeMarkup;
    let cardH = 62 + (preCalcLines - 1) * 4.5;
    if (p.scholarship && p.scholarship > 0) cardH += 6;
    if (p.applicationFee && p.applicationFee > 0) cardH += 6;
    if (preCalcServiceFee > 0) cardH += 6;
    if (showCommission && commAmt != null) cardH += 8;

    if (currentY + cardH > pageH - 20) {
      pageCount++;
      doc.addPage();
      drawHeader(false);
      currentY = 50;
    }

    drawRoundedRect(doc, margin, currentY, contentW, cardH, 3, [250, 250, 252]);

    doc.setDrawColor(PRIMARY[0], PRIMARY[1], PRIMARY[2]);
    doc.setLineWidth(0.8);
    doc.line(margin, currentY, margin, currentY + cardH);

    const innerX = margin + 5;
    let innerY = currentY + 7;

    doc.setFillColor(PRIMARY[0], PRIMARY[1], PRIMARY[2]);
    doc.roundedRect(innerX, currentY + 3.5, 16, 5, 1, 1, "F");
    doc.setTextColor(WHITE[0], WHITE[1], WHITE[2]);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text(`#${i + 1}`, innerX + 8, currentY + 7, { align: "center" });

    const nameX = innerX + 20;

    if (p.universityLogoUrl && uniLogos.get(p.universityLogoUrl)) {
      try {
        const uniLogoData = uniLogos.get(p.universityLogoUrl)!;
        doc.addImage(uniLogoData, detectImageFormat(uniLogoData), nameX - 1, currentY + 3, 7, 7);
      } catch {}
    }

    const textStartX = (p.universityLogoUrl && uniLogos.get(p.universityLogoUrl)) ? nameX + 8 : nameX;

    doc.setTextColor(GRAY[0], GRAY[1], GRAY[2]);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(p.universityName, textStartX, innerY - 1.5);

    doc.setTextColor(DARK[0], DARK[1], DARK[2]);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    const maxNameW = margin + contentW - 5 - textStartX;
    const programName = doc.splitTextToSize(p.name, maxNameW) as string[];
    const nameLines = Math.min(programName.length, 2);
    for (let nl = 0; nl < nameLines; nl++) {
      doc.text(programName[nl], textStartX, innerY + 3.5 + nl * 4.5);
    }

    innerY += 6 + (nameLines - 1) * 4.5;

    const badges: string[] = [];
    if (p.degree) badges.push(p.degree);
    if (p.language) badges.push(p.language);
    if (p.duration) badges.push(p.duration);
    if (p.universityCountry) badges.push(p.universityCountry);
    if (p.universityCity) badges.push(p.universityCity);

    let bx = innerX;
    badges.forEach(badge => {
      const tw = doc.getTextWidth(badge) + 4;
      drawRoundedRect(doc, bx, innerY, tw + 2, 5, 1, PRIMARY_LIGHT);
      doc.setTextColor(PRIMARY[0], PRIMARY[1], PRIMARY[2]);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.text(badge, bx + 2, innerY + 3.5);
      bx += tw + 4;
    });

    innerY += 10;

    drawLine(doc, innerX, innerY, margin + contentW - 5, innerY, [226, 232, 240]);
    innerY += 5;

    const col1 = innerX;
    const col2 = innerX + contentW / 2 - 5;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(GRAY[0], GRAY[1], GRAY[2]);
    doc.text("Tuition Fee" + (p.feeType ? ` (${p.feeType})` : ""), col1, innerY);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(DARK[0], DARK[1], DARK[2]);
    if (hasDiscount) {
      doc.setTextColor(GRAY[0], GRAY[1], GRAY[2]);
      doc.setFont("helvetica", "normal");
      const oldFee = fmt(p.tuitionFee, cur);
      doc.text(oldFee, col2, innerY, { align: "right" });
      const oldW = doc.getTextWidth(oldFee);
      doc.setDrawColor(GRAY[0], GRAY[1], GRAY[2]);
      doc.setLineWidth(0.3);
      doc.line(col2 - oldW, innerY - 1.2, col2, innerY - 1.2);

      doc.setFont("helvetica", "bold");
      doc.setTextColor(ACCENT[0], ACCENT[1], ACCENT[2]);
      doc.text(fmt(p.discountedFee, cur), col2 + 25, innerY, { align: "right" });
    } else {
      doc.text(fmt(p.tuitionFee, cur), col2, innerY, { align: "right" });
    }

    innerY += 6;

    if (p.scholarship && p.scholarship > 0) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(ACCENT[0], ACCENT[1], ACCENT[2]);
      doc.text("Scholarship", col1, innerY);
      doc.setFont("helvetica", "bold");
      doc.text(fmt(p.scholarship, cur), col2, innerY, { align: "right" });
      innerY += 6;
    }

    if (p.applicationFee && p.applicationFee > 0) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(GRAY[0], GRAY[1], GRAY[2]);
      doc.text("Application Fee", col1, innerY);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(DARK[0], DARK[1], DARK[2]);
      doc.text(fmt(p.applicationFee, cur), col2, innerY, { align: "right" });
      innerY += 6;
    }

    const rawServiceFee = p.serviceFeeAmount ?? 0;
    const adjustedServiceFee = rawServiceFee + serviceFeeMarkup;
    if (adjustedServiceFee > 0) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(GRAY[0], GRAY[1], GRAY[2]);
      doc.text("Service Fee", col1, innerY);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(DARK[0], DARK[1], DARK[2]);
      doc.text(fmt(adjustedServiceFee, cur), col2, innerY, { align: "right" });
      innerY += 6;
    }

    if (p.intakes) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(GRAY[0], GRAY[1], GRAY[2]);
      doc.text("Intakes", col1, innerY);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(DARK[0], DARK[1], DARK[2]);
      doc.text(p.intakes, col2, innerY, { align: "right" });
      innerY += 6;
    }

    if (showCommission && commAmt != null) {
      drawLine(doc, innerX, innerY - 2, margin + contentW - 5, innerY - 2, [226, 232, 240], 0.5);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(PRIMARY[0], PRIMARY[1], PRIMARY[2]);
      doc.text("Commission", col1, innerY + 3);
      doc.text(fmt(commAmt, cur), col2, innerY + 3, { align: "right" });
    }

    currentY += cardH + 6;
  }

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    drawFooter(i, totalPages);
  }

  doc.save(`${companyName.replace(/\s+/g, "_")}_Proposal_${new Date().toISOString().slice(0, 10)}.pdf`);
}
