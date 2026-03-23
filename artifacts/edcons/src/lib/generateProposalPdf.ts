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
  hideServiceFee?: boolean;
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

const BLUE = [41, 98, 255];
const BLUE_DARK = [30, 64, 175];
const NAVY = [15, 23, 42];
const DARK = [30, 41, 59];
const BODY = [71, 85, 105];
const SUBTLE = [148, 163, 184];
const BORDER = [226, 232, 240];
const LIGHT_BG = [248, 250, 252];
const WHITE = [255, 255, 255];
const EMERALD = [16, 185, 129];
const AMBER = [245, 158, 11];

export async function generateProposalPdf(options: ProposalOptions) {
  const { programs, logoDataUrl, companyName = "Find And Study", companyEmail, companyPhone, companyWebsite, hideServiceFee = false, serviceFeeMarkup = 0 } = options;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = 210;
  const pageH = 297;
  const mx = 18;
  const cw = pageW - mx * 2;
  const { date: dateStr, time: timeStr } = getTurkeyDateTime();

  const uniLogos = new Map<string, string | null>();
  const uniLogoUrls = [...new Set(programs.filter(p => p.universityLogoUrl).map(p => p.universityLogoUrl!))];
  await Promise.all(uniLogoUrls.map(async (url) => {
    uniLogos.set(url, await loadImageAsDataUrl(url));
  }));

  function setC(c: number[]) { doc.setTextColor(c[0], c[1], c[2]); }
  function setF(c: number[]) { doc.setFillColor(c[0], c[1], c[2]); }

  function drawHeader(isFirst: boolean) {
    setF(WHITE);
    doc.rect(0, 0, pageW, 32, "F");

    let logoRight = mx;
    if (logoDataUrl) {
      try {
        doc.addImage(logoDataUrl, detectImageFormat(logoDataUrl), mx, 5, 22, 22);
        logoRight = mx + 26;
      } catch {
        logoRight = mx;
      }
    }

    setC(NAVY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(companyName, logoRight, 15);

    setC(SUBTLE);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text(isFirst ? "Program Proposal" : "Program Proposal (continued)", logoRight, 21);

    const contactParts: string[] = [];
    if (companyPhone) contactParts.push(companyPhone);
    if (companyEmail) contactParts.push(companyEmail);
    if (companyWebsite) contactParts.push(companyWebsite);

    if (contactParts.length > 0) {
      setC(BODY);
      doc.setFontSize(6.5);
      doc.text(contactParts.join("  |  "), pageW - mx, 14, { align: "right" });
    }

    setC(BLUE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text(`${dateStr}  ${timeStr}`, pageW - mx, 20, { align: "right" });

    setF(BLUE);
    doc.rect(0, 31, pageW, 0.6, "F");
    setF([241, 245, 249]);
    doc.rect(0, 31.6, pageW, 0.3, "F");
  }

  function drawFooter(pageNum: number, totalPages: number) {
    const fy = pageH - 10;
    doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
    doc.setLineWidth(0.3);
    doc.line(mx, fy, pageW - mx, fy);

    setC(SUBTLE);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6);
    doc.text(companyName, mx, fy + 4);
    doc.text(`${pageNum} / ${totalPages}`, pageW - mx, fy + 4, { align: "right" });
  }

  let cy = 40;

  drawHeader(true);

  setC(NAVY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Selected Programs", mx, cy);
  cy += 6;

  setC(SUBTLE);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text(`${programs.length} program${programs.length !== 1 ? "s" : ""} curated for your review`, mx, cy);
  cy += 8;

  for (let i = 0; i < programs.length; i++) {
    const p = programs[i];
    const cur = p.currency ?? "USD";
    const hasDiscount = p.discountedFee != null && p.tuitionFee != null && p.discountedFee < p.tuitionFee;
    const hasScholarship = p.scholarship != null && p.scholarship > 0;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    const nameLines = Math.min(doc.splitTextToSize(p.name, cw - 36).length, 2);
    const showServiceFee = !hideServiceFee && ((p.serviceFeeAmount ?? 0) + serviceFeeMarkup) > 0;
    let rowCount = 1;
    if (hasScholarship) rowCount++;
    if (p.applicationFee && p.applicationFee > 0) rowCount++;
    if (showServiceFee) rowCount++;
    if (p.intakes) rowCount++;
    const cardH = 38 + (nameLines - 1) * 5 + rowCount * 7;

    if (cy + cardH + 4 > pageH - 16) {
      doc.addPage();
      drawHeader(false);
      cy = 40;
    }

    setF(LIGHT_BG);
    doc.roundedRect(mx, cy, cw, cardH, 3, 3, "F");
    doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
    doc.setLineWidth(0.2);
    doc.roundedRect(mx, cy, cw, cardH, 3, 3, "S");

    const ix = mx + 6;
    let iy = cy + 6;

    setF(BLUE);
    doc.roundedRect(ix, iy - 2.5, 11, 5, 1.2, 1.2, "F");
    setC(WHITE);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text(`${i + 1}`, ix + 5.5, iy + 1, { align: "center" });

    let tx = ix + 14;
    if (p.universityLogoUrl && uniLogos.get(p.universityLogoUrl)) {
      try {
        const uld = uniLogos.get(p.universityLogoUrl)!;
        doc.addImage(uld, detectImageFormat(uld), tx, iy - 3.5, 6, 6);
        tx += 8;
      } catch {}
    }

    setC(SUBTLE);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text(p.universityName, tx, iy - 0.5);

    setC(NAVY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    const maxNameW = mx + cw - 6 - tx;
    const pName = doc.splitTextToSize(p.name, maxNameW) as string[];
    for (let nl = 0; nl < Math.min(pName.length, 2); nl++) {
      doc.text(pName[nl], tx, iy + 4.5 + nl * 5);
    }
    iy += 7 + (Math.min(pName.length, 2) - 1) * 5;

    const badges: string[] = [];
    if (p.degree) badges.push(p.degree);
    if (p.language) badges.push(p.language);
    if (p.duration) badges.push(p.duration);
    if (p.universityType) badges.push(p.universityType);
    if (p.universityCity) badges.push(p.universityCity);

    let bx = ix;
    for (const badge of badges) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6);
      const bw = doc.getTextWidth(badge) + 4;
      if (bx + bw > mx + cw - 6) break;
      setF([241, 245, 249]);
      doc.roundedRect(bx, iy, bw, 4.5, 1, 1, "F");
      doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
      doc.setLineWidth(0.15);
      doc.roundedRect(bx, iy, bw, 4.5, 1, 1, "S");
      setC(DARK);
      doc.text(badge, bx + 2, iy + 3.2);
      bx += bw + 2;
    }

    iy += 8;

    doc.setDrawColor(BORDER[0], BORDER[1], BORDER[2]);
    doc.setLineWidth(0.15);
    doc.line(ix, iy, mx + cw - 6, iy);
    iy += 5;

    const rv = mx + cw - 6;

    function drawRow(label: string, value: string, labelColor: number[], valueColor: number[], valueBold = true) {
      setC(labelColor);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(label, ix, iy);
      setC(valueColor);
      doc.setFont("helvetica", valueBold ? "bold" : "normal");
      doc.text(value, rv, iy, { align: "right" });
      iy += 7;
    }

    const feeLabel = "Tuition Fee" + (p.feeType ? ` (${p.feeType})` : "");
    if (hasDiscount) {
      setC(BODY);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text(feeLabel, ix, iy);

      if (hasScholarship) {
        const scholarshipPct = p.tuitionFee && p.tuitionFee > 0
          ? Math.round((p.scholarship! / p.tuitionFee) * 100)
          : 0;
        if (scholarshipPct > 0) {
          const pctText = `(${scholarshipPct}% Scholarship)`;
          doc.setFont("helvetica", "normal");
          doc.setFontSize(6.5);
          setC(EMERALD);
          const labelW = doc.getTextWidth(feeLabel);
          doc.text(pctText, ix + labelW + 3, iy);
        }
      }

      setC(SUBTLE);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      const oldFee = fmt(p.tuitionFee, cur);
      const oldW = doc.getTextWidth(oldFee);
      const oldX = rv - 25;
      doc.text(oldFee, oldX, iy, { align: "right" });
      doc.setDrawColor(SUBTLE[0], SUBTLE[1], SUBTLE[2]);
      doc.setLineWidth(0.3);
      doc.line(oldX - oldW, iy - 1.2, oldX, iy - 1.2);

      setC(EMERALD);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text(fmt(p.discountedFee, cur), rv, iy, { align: "right" });
      iy += 7;
    } else {
      drawRow(feeLabel, fmt(p.tuitionFee, cur), BODY, NAVY);
    }

    if (hasScholarship && !hasDiscount) {
      drawRow("Scholarship", fmt(p.scholarship, cur), EMERALD, EMERALD);
    }

    if (p.applicationFee && p.applicationFee > 0) {
      drawRow("Application Fee", fmt(p.applicationFee, cur), BODY, DARK);
    }

    if (showServiceFee) {
      const totalServiceFee = (p.serviceFeeAmount ?? 0) + serviceFeeMarkup;
      drawRow("Service Fee", fmt(totalServiceFee, cur), BODY, DARK);
    }

    if (p.intakes) {
      setC(BODY);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text("Intakes", ix, iy);
      setC(BLUE);
      doc.setFont("helvetica", "bold");
      doc.text(p.intakes, rv, iy, { align: "right" });
      iy += 7;
    }

    cy += cardH + 5;
  }

  const totalPages = doc.getNumberOfPages();
  for (let pg = 1; pg <= totalPages; pg++) {
    doc.setPage(pg);
    drawFooter(pg, totalPages);
  }

  const fileName = `${companyName.replace(/\s+/g, "_")}_Proposal_${dateStr}_${timeStr.replace(":", "-")}.pdf`;
  doc.save(fileName);
}
