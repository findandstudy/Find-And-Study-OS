import crypto from "node:crypto";

export const DORMBOOKING_KNOWLEDGE_SOURCE_TYPE = "dormbooking";
export const DORMBOOKING_KNOWLEDGE_SOURCE_NAME = "DormBooking Live Catalog";
export const DORMBOOKING_PUBLIC_BASE_URL = "https://dormbooking.com";
export const DORMBOOKING_CATALOG_PATH = "/wp-json/dormbooking/v1/ai-catalog";
export const DORMBOOKING_CHUNK_FORMAT_VERSION = "dorm-v1";

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
  image?: string | null;
  gallery?: string[];
  rooms?: DormBookingRoom[];
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
  text: string;
}

export interface DormBookingCatalogExtract {
  text: string;
  documents: DormBookingDocument[];
  sourceVersion: string;
  dormCount: number;
  roomCount: number;
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

function hasCompletePrice(room: DormBookingRoom, dormCurrency: unknown): boolean {
  return safeNumber(room.listedPrice) !== null
    && Boolean(safeText(room.currency ?? dormCurrency))
    && Boolean(safeText(room.feePeriod ?? room.priceBasis))
    && safeNumber(room.holdingFee) !== null
    && safeNumber(room.deposit) !== null;
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
  "Istanbul Okan University Female Student Dormitories",
]);

export function buildDormBookingCatalogDocuments(
  dormsInput: DormBookingDorm[],
): Omit<DormBookingCatalogExtract, "sourceVersion" | "fetchedAt"> {
  const dorms = Array.isArray(dormsInput) ? dormsInput : [];
  const preface = [
    "SOURCE: DormBooking official published accommodation catalog.",
    "AUDIENCE: International students looking for accommodation in a city covered by DormBooking.",
    "FRESHNESS: Prices and availability can change. Confirm both before promising or accepting a reservation.",
    "PRICE SAFETY: A room is price-complete only when price, currency, exact fee period, Holding Fee and deposit are all present. Otherwise do not quote any price; hand off for confirmation.",
    "BOOKING SAFETY: Never guarantee a room. The Holding Fee varies by dormitory and room, forms part of the accommodation total, and must only be quoted from the selected room's current listing.",
    "PRIVACY: Do not disclose partner contact details, internal terms, commissions or unpublished information.",
  ].join("\n");

  const documents = dorms
    .filter((dorm) => Number.isInteger(dorm?.id) && safeText(dorm?.name) && safeText(dorm?.url))
    .filter((dorm) => !QUARANTINED_GENDER_RECORDS.has(safeText(dorm.name)))
    .map((dorm) => {
      const dormName = safeText(dorm.name);
      const city = safeText(dorm.city) || "Istanbul";
      const genderEligibility = deriveGenderEligibility(dorm);
      const nearbyUniversities = safeList(dorm.nearbyUniversities);
      const rooms = Array.isArray(dorm.rooms) ? dorm.rooms : [];
      const roomBlocks = rooms
        .filter((room) => Number.isInteger(room?.id) && safeText(room?.name))
        .map((room) => {
          const completePrice = hasCompletePrice(room, dorm.currency);
          return [
          `ROOM: ${safeText(room.name)}`,
          `Room ID: ${room.id}`,
          safeText(room.url) ? `Public page: ${safeText(room.url)}` : "",
          completePrice
            ? `Accommodation price: ${formatListedPrice(room.listedPrice, room.currency ?? dorm.currency, room.feePeriod ?? room.priceBasis)}`
            : "PRICE STATUS: Incomplete; do not quote a price. Hand off for exact price and payment-plan confirmation.",
          completePrice ? `Holding Fee: ${formatListedPrice(room.holdingFee, room.currency ?? dorm.currency, "part of accommodation total")}` : "",
          completePrice ? `Deposit: ${formatListedPrice(room.deposit, room.currency ?? dorm.currency, "listing value")}` : "",
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
        text,
      };
    })
    .sort((a, b) => a.dormName.localeCompare(b.dormName, "en"));

  return {
    text: documents.map((document) => document.text).join("\n\n---\n\n"),
    documents,
    dormCount: documents.length,
    roomCount: documents.reduce((total, document) =>
      total + (document.text.match(/^ROOM:/gm)?.length ?? 0), 0),
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
