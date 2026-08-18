import crypto from "node:crypto";

export const DORMBOOKING_KNOWLEDGE_SOURCE_TYPE = "dormbooking";
export const DORMBOOKING_KNOWLEDGE_SOURCE_NAME = "DormBooking Live Catalog";
export const DORMBOOKING_PUBLIC_BASE_URL = "https://dormbooking.com";
export const DORMBOOKING_CATALOG_PATH = "/wp-json/dormbooking/v1/ai-catalog";
export const DORMBOOKING_CHUNK_FORMAT_VERSION = "dorm-v2";

const FETCH_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_PAGES = 100;

interface DormBookingRoom {
  id?: number;
  name?: string;
  url?: string;
  modifiedAt?: string;
  description?: string;
  listedPrice?: number | string | null;
  currency?: string | null;
  priceBasis?: string | null;
  feePeriod?: string | null;
  holdingFee?: number | string | null;
  deposit?: number | string | null;
  contractStart?: string | null;
  contractEnd?: string | null;
  instalmentPlan?: string | string[] | null;
  installmentPlan?: string | string[] | null;
  roomCount?: number | string | null;
  adults?: number | string | null;
  children?: number | string | null;
  beds?: number | string | null;
  bathrooms?: number | string | null;
  areaSquareMeters?: number | string | null;
  facilities?: string[];
  image?: string | null;
  gallery?: string[];
  bookingMode?: string | null;
}

interface DormBookingDorm {
  id?: number;
  name?: string;
  url?: string;
  modifiedAt?: string;
  description?: string;
  address?: string;
  city?: string;
  latitude?: number | string | null;
  longitude?: number | string | null;
  accommodationTypes?: string[];
  gender?: string | null;
  facilities?: string[];
  nearbyUniversities?: string[];
  rating?: number | string | null;
  averageListedPrice?: number | string | null;
  currency?: string | null;
  checkIn?: string | null;
  checkOut?: string | null;
  contractStart?: string | null;
  contractEnd?: string | null;
  image?: string | null;
  gallery?: string[];
  rooms?: DormBookingRoom[];
  suppressed?: boolean | number | string | null;
  visibility?: string | null;
}

interface DormBookingCatalogPayload {
  success?: boolean;
  dorms?: DormBookingDorm[];
  pagination?: {
    page?: number;
    perPage?: number;
    total?: number;
    totalPages?: number;
  };
}

export interface DormBookingDocument {
  dormId: number;
  dormName: string;
  city: string;
  nearbyUniversities: string[];
  sourceUrl: string;
  rooms: DormBookingRoomCost[];
  text: string;
}

export interface DormBookingRoomCost {
  roomId: number;
  roomName: string;
  price: number | null;
  currency: string | null;
  feePeriod: string | null;
  holdingFee: number | null;
  netAccommodationFee: number | null;
  advancePayment30: number | null;
  remainingPayment70: number | null;
  contractStart: string | null;
  contractEnd: string | null;
  instalmentPlan: string[] | null;
  missingFields: string[];
}

export interface DormBookingCatalogExtract {
  text: string;
  documents: DormBookingDocument[];
  sourceVersion: string;
  dormCount: number;
  roomCount: number;
  incompletePricedRoomCount: number;
  incompletePriceFields: Record<string, number>;
  suppressedDormCount: number;
  fetchedAt: string;
}

function safeText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function studentSafeText(value: unknown): string {
  return safeText(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[contact removed]")
    .replace(/\b(?:phone|telephone|tel|whatsapp|e-mail|email)\s*[:：-]?\s*\+?[\d\s().-]{7,}\d/gi, "[contact removed]");
}

function safeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(/,/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function safeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(safeText).filter(Boolean))];
}

function formatListedPrice(value: unknown, currency: unknown, basis: unknown): string {
  const amount = safeNumber(value);
  if (amount === null) return "Not listed";
  const safeCurrency = safeText(currency) || "USD";
  const safeBasis = safeText(basis);
  return `${safeCurrency} ${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}${safeBasis ? ` (${safeBasis})` : " (billing period not specified)"}`;
}

function safeInstalmentPlan(value: unknown): string[] | null {
  if (Array.isArray(value)) {
    const items = value.map(safeText).filter(Boolean);
    return items.length ? items : null;
  }
  const text = safeText(value);
  return text ? [text] : null;
}

function normalizeContractDate(value: unknown): string | null {
  const text = safeText(value);
  if (!text) return null;
  const iso = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  const dmy = text.match(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/);
  const year = Number(iso?.[1] ?? dmy?.[3]);
  const month = Number(iso?.[2] ?? dmy?.[2]);
  const day = Number(iso?.[3] ?? dmy?.[1]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function extractDormContractDate(description: unknown, label: "checkIn" | "checkOut"): string | null {
  const text = safeText(description);
  if (!text) return null;
  if (label === "checkIn") {
    return text.match(/\bCheck\s*In\s*:\s*(\d{1,2}[/.]\d{1,2}[/.]\d{4})/i)?.[1] ?? null;
  }
  return text.match(/\bCheck\s*Out\s*:\s*(\d{1,2}[/.]\d{1,2}[/.]\d{4})/i)?.[1] ?? null;
}

function deriveInstalmentPlan(room: DormBookingRoom): string[] | null {
  const explicit = safeInstalmentPlan(room.instalmentPlan ?? room.installmentPlan) ?? [];
  const roomNamePlan = safeText(room.name)
    .split("|")
    .map((part) => part.trim())
    .find((part) => /\b(?:instal+l?ment|advance\s+payment|monthly\s+payment)\b/i.test(part));
  const plans = [...new Set([...explicit, roomNamePlan].map(safeText).filter(Boolean))];
  return plans.length ? plans : null;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isContractTotalBasis(value: unknown): boolean {
  const basis = safeText(value).toLowerCase();
  return /(?:academic[ _-]?(?:season|year)|contract|total|full[ _-]?stay)/.test(basis);
}

function roomCost(room: DormBookingRoom, dorm: DormBookingDorm): DormBookingRoomCost {
  const dormCheckIn = dorm.contractStart ?? dorm.checkIn ?? extractDormContractDate(dorm.description, "checkIn");
  const dormCheckOut = dorm.contractEnd ?? dorm.checkOut ?? extractDormContractDate(dorm.description, "checkOut");
  const price = safeNumber(room.listedPrice);
  const holdingFee = safeNumber(room.holdingFee);
  const hasComputableTotal = price !== null && holdingFee !== null && holdingFee <= price
    && isContractTotalBasis(room.feePeriod ?? room.priceBasis);
  const netAccommodationFee = hasComputableTotal ? roundMoney(price - holdingFee) : null;
  const result: DormBookingRoomCost = {
    roomId: Number(room.id),
    roomName: safeText(room.name),
    price,
    currency: safeText(room.currency ?? dorm.currency) || null,
    feePeriod: safeText(room.feePeriod ?? room.priceBasis) || null,
    holdingFee,
    netAccommodationFee,
    advancePayment30: netAccommodationFee === null ? null : roundMoney(netAccommodationFee * 0.3),
    remainingPayment70: netAccommodationFee === null ? null : roundMoney(netAccommodationFee * 0.7),
    contractStart: normalizeContractDate(room.contractStart ?? dormCheckIn),
    contractEnd: normalizeContractDate(room.contractEnd ?? dormCheckOut),
    instalmentPlan: deriveInstalmentPlan(room),
    missingFields: [],
  };
  result.missingFields = ([
    ["price", result.price],
    ["currency", result.currency],
    ["fee_period", result.feePeriod],
    ["holding_fee", result.holdingFee],
    ["contract_start", result.contractStart],
    ["contract_end", result.contractEnd],
    ["instalment_plan", result.instalmentPlan],
  ] as const).filter(([, value]) => value === null).map(([field]) => field);
  return result;
}

function deriveGenderEligibility(dorm: DormBookingDorm): string {
  const explicit = safeText(dorm.gender);
  if (explicit) return explicit;
  const types = safeList(dorm.accommodationTypes);
  // Match complete leading words. Never use `includes("male")` because the
  // string "female" itself contains "male".
  const female = types.some((value) => /^female(?:\b|\s*-)/i.test(value));
  const male = types.some((value) => /^male(?:\b|\s*-)/i.test(value));
  if (female && male) return "Male and female (separate listing eligibility)";
  if (female) return "Female only";
  if (male) return "Male only";
  return "";
}

const QUARANTINED_GENDER_RECORDS = new Set([
  "Istanbul Medipol University Male Student Dormitory",
  "Istanbul Medipol University Female Student Dormitory",
  "Istanbul Okan University Female Student Dormitories",
]);

function isSuppressedDorm(dorm: DormBookingDorm): boolean {
  const explicit = dorm.suppressed === true || dorm.suppressed === 1
    || String(dorm.suppressed ?? "").toLowerCase() === "true";
  const hidden = ["hidden", "suppressed", "private", "draft"].includes(safeText(dorm.visibility).toLowerCase());
  return explicit || hidden || QUARANTINED_GENDER_RECORDS.has(safeText(dorm.name));
}

export function buildDormBookingCatalogDocuments(
  dormsInput: DormBookingDorm[],
): Omit<DormBookingCatalogExtract, "sourceVersion" | "fetchedAt"> {
  const dorms = Array.isArray(dormsInput) ? dormsInput : [];
  const preface = [
    "SOURCE: DormBooking official published accommodation catalog.",
    "AUDIENCE: International students looking for accommodation in a city covered by DormBooking.",
    "FRESHNESS: Prices and availability can change. Confirm both before promising or accepting a reservation.",
    "PRICE SAFETY: Quote a published price only when price is not null. Every cost field is explicit; never invent a missing currency, fee period, Holding Fee, contract date or instalment plan. State the specific missing field and request staff confirmation.",
    "BOOKING SAFETY: Never guarantee a room. The Holding Fee varies by dormitory and room, forms part of the accommodation total, and must only be quoted from the selected room's current listing.",
    "STANDARD PAYMENT FORMULA: First pay the selected room's Holding Fee. The next payment is 30% of (total accommodation fee minus Holding Fee). The remaining balance is 70% of (total accommodation fee minus Holding Fee). How and when that remaining 70% is paid varies by dormitory and room; never apply one room's instalment schedule to another room.",
    "PRIVACY: Do not disclose partner contact details, internal terms, commissions or unpublished information.",
  ].join("\n");

  const eligibleDorms = dorms
    .filter((dorm) => Number.isInteger(dorm?.id) && safeText(dorm?.name) && safeText(dorm?.url))
    .filter((dorm) => !isSuppressedDorm(dorm));
  const documents = eligibleDorms
    .map((dorm) => {
      const dormName = safeText(dorm.name);
      const city = dormName === "Private Yalova Evim Male Student Dormitory"
        ? "Yalova"
        : safeText(dorm.city) || "Istanbul";
      const genderEligibility = deriveGenderEligibility(dorm);
      const nearbyUniversities = safeList(dorm.nearbyUniversities);
      const rooms = Array.isArray(dorm.rooms) ? dorm.rooms : [];
      const structuredRooms = rooms
        .filter((room) => Number.isInteger(room?.id) && safeText(room?.name))
        .map((room) => roomCost(room, dorm));
      const roomBlocks = rooms
        .filter((room) => Number.isInteger(room?.id) && safeText(room?.name))
        .map((room) => {
          const cost = roomCost(room, dorm);
          const costJson = JSON.stringify({
            price: cost.price,
            currency: cost.currency,
            fee_period: cost.feePeriod,
            holding_fee: cost.holdingFee,
            net_accommodation_fee: cost.netAccommodationFee,
            advance_payment_30: cost.advancePayment30,
            remaining_payment_70: cost.remainingPayment70,
            contract_start: cost.contractStart,
            contract_end: cost.contractEnd,
            instalment_plan: cost.instalmentPlan,
          });
          return [
          `ROOM: ${safeText(room.name)}`,
          `Room ID: ${room.id}`,
          safeText(room.url) ? `Public page: ${safeText(room.url)}` : "",
          `CATALOG COST JSON: ${costJson}`,
          cost.price !== null
            ? `Accommodation price: ${formatListedPrice(room.listedPrice, room.currency ?? dorm.currency, room.feePeriod ?? room.priceBasis)}`
            : "PRICE STATUS: price is null; do not quote a price. Hand off for exact price confirmation.",
          cost.holdingFee !== null ? `Holding Fee: ${formatListedPrice(room.holdingFee, room.currency ?? dorm.currency, "part of accommodation total")}` : "",
          cost.advancePayment30 !== null ? `30% payment after Holding Fee: ${formatListedPrice(cost.advancePayment30, room.currency ?? dorm.currency, "30% of total accommodation fee minus Holding Fee")}` : "",
          cost.remainingPayment70 !== null ? `Remaining 70%: ${formatListedPrice(cost.remainingPayment70, room.currency ?? dorm.currency, "payment schedule varies by selected dormitory and room")}` : "",
          safeNumber(room.deposit) !== null ? `Deposit: ${formatListedPrice(room.deposit, room.currency ?? dorm.currency, "listing value")}` : "",
          cost.missingFields.length ? `MISSING COST FIELDS: ${cost.missingFields.join(", ")}` : "COST RECORD STATUS: complete",
          safeNumber(room.roomCount) !== null ? `Published room count: ${safeNumber(room.roomCount)}` : "",
          safeNumber(room.adults) !== null ? `Maximum adults: ${safeNumber(room.adults)}` : "",
          safeNumber(room.children) !== null ? `Maximum children: ${safeNumber(room.children)}` : "",
          safeNumber(room.beds) !== null ? `Beds: ${safeNumber(room.beds)}` : "",
          safeNumber(room.bathrooms) !== null ? `Bathrooms: ${safeNumber(room.bathrooms)}` : "",
          safeNumber(room.areaSquareMeters) !== null ? `Area: ${safeNumber(room.areaSquareMeters)} m²` : "",
          safeList(room.facilities).length ? `Room facilities: ${safeList(room.facilities).join(", ")}` : "",
          studentSafeText(room.description) ? `Room description: ${studentSafeText(room.description)}` : "",
          safeText(room.modifiedAt) ? `Room updated: ${safeText(room.modifiedAt)}` : "",
          ].filter(Boolean).join("\n");
        });

      const text = [
        preface,
        `DORM: ${dormName}`,
        `Dorm ID: ${dorm.id}`,
        `Public page: ${safeText(dorm.url)}`,
        `City: ${city}`,
        genderEligibility ? `Gender eligibility: ${genderEligibility}` : "Gender eligibility: Not verified; do not recommend until staff confirms.",
        safeText(dorm.address) ? `Address: ${safeText(dorm.address)}` : "",
        nearbyUniversities.length ? `Nearby universities: ${nearbyUniversities.join(", ")}` : "",
        safeList(dorm.accommodationTypes).length ? `Accommodation type: ${safeList(dorm.accommodationTypes).join(", ")}` : "",
        safeList(dorm.facilities).length ? `Dorm facilities: ${safeList(dorm.facilities).join(", ")}` : "",
        safeNumber(dorm.rating) !== null ? `Published rating: ${safeNumber(dorm.rating)}` : "",
        studentSafeText(dorm.description) ? `Dorm description: ${studentSafeText(dorm.description)}` : "",
        safeText(dorm.modifiedAt) ? `Dorm updated: ${safeText(dorm.modifiedAt)}` : "",
        roomBlocks.length ? `PUBLISHED ROOMS:\n${roomBlocks.join("\n\n")}` : "PUBLISHED ROOMS: None listed; ask staff to check availability.",
      ].filter(Boolean).join("\n");

      return {
        dormId: dorm.id!,
        dormName,
        city,
        nearbyUniversities,
        sourceUrl: safeText(dorm.url),
        rooms: structuredRooms,
        text,
      };
    })
    .sort((a, b) => a.dormName.localeCompare(b.dormName, "en"));

  const allRooms = documents.flatMap((document) => document.rooms);
  const incompletePriceFields: Record<string, number> = {};
  for (const room of allRooms.filter((item) => item.price !== null)) {
    for (const field of room.missingFields) incompletePriceFields[field] = (incompletePriceFields[field] ?? 0) + 1;
  }
  return {
    text: documents.map((document) => document.text).join("\n\n---\n\n"),
    documents,
    dormCount: documents.length,
    roomCount: documents.reduce((total, document) =>
      total + (document.text.match(/^ROOM:/gm)?.length ?? 0), 0),
    incompletePricedRoomCount: allRooms.filter((room) => room.price !== null && room.missingFields.length > 0).length,
    incompletePriceFields,
    suppressedDormCount: dorms.filter(isSuppressedDorm).length,
  };
}

async function fetchCatalogPage(page: number): Promise<{ payload: DormBookingCatalogPayload; etag: string }> {
  const url = new URL(DORMBOOKING_CATALOG_PATH, DORMBOOKING_PUBLIC_BASE_URL);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", "50");
  if (url.protocol !== "https:" || url.origin !== DORMBOOKING_PUBLIC_BASE_URL || url.pathname !== DORMBOOKING_CATALOG_PATH) {
    throw new Error("DormBooking source URL is not allowed.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "error",
      headers: { Accept: "application/json", "User-Agent": "FindAndStudyOS-DormBookingSync/1.0" },
    });
    if (!response.ok) throw new Error(`DormBooking fetch failed: HTTP ${response.status}`);
    if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
      throw new Error("DormBooking returned a non-JSON response.");
    }
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("DormBooking response is too large.");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_RESPONSE_BYTES) throw new Error("DormBooking response is too large.");
    return {
      payload: JSON.parse(buffer.toString("utf8")) as DormBookingCatalogPayload,
      etag: response.headers.get("etag") ?? "",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function extractDormBookingCatalog(): Promise<DormBookingCatalogExtract> {
  const dorms: DormBookingDorm[] = [];
  const etags: string[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const result = await fetchCatalogPage(page);
    if (result.payload.success === false || !Array.isArray(result.payload.dorms)) {
      throw new Error("DormBooking reported an invalid catalog response.");
    }
    dorms.push(...result.payload.dorms);
    if (result.etag) etags.push(result.etag);
    totalPages = Math.max(1, Number(result.payload.pagination?.totalPages ?? 1));
    if (!Number.isFinite(totalPages) || totalPages > MAX_PAGES) {
      throw new Error("DormBooking pagination is invalid.");
    }
    page += 1;
  } while (page <= totalPages);

  const document = buildDormBookingCatalogDocuments(dorms);
  if (!document.text.trim() || document.dormCount === 0) {
    throw new Error("DormBooking returned no published dorm content.");
  }
  const upstreamVersion = etags.length === totalPages
    ? etags.join(":")
    : crypto.createHash("sha256").update(document.text).digest("hex");
  return {
    ...document,
    sourceVersion: `${upstreamVersion}:${DORMBOOKING_CHUNK_FORMAT_VERSION}`,
    fetchedAt: new Date().toISOString(),
  };
}
