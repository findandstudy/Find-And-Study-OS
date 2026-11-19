import { detailDisplayTerm, type DetailContent, type DetailContentKind } from "@/lib/website/detailContentContract";

type UnknownRecord = Record<string, unknown>;
const record = (value: unknown): UnknownRecord => value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
const stringValue = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
const numberValue = (value: unknown, locale: string): string | null => typeof value === "number" && Number.isFinite(value) ? new Intl.NumberFormat(locale).format(value) : null;
const moneyValue = (amount: unknown, currency: unknown, locale: string): string | null => {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || typeof currency !== "string" || !/^[A-Z]{3}$/i.test(currency)) return null;
  try { return new Intl.NumberFormat(locale, { style: "currency", currency: currency.toUpperCase(), maximumFractionDigits: 2 }).format(amount); }
  catch { return null; }
};

/** Converts the already-public page projection into the strict shared-template variable set. */
export function detailTemplateVariableValues(kind: DetailContentKind, payload: unknown, locale: string, content?: DetailContent | null): Record<string, string | null> {
  const root = record(payload);
  const data = record(root.data);
  const stats = record(root.stats);
  const meta = record(root.meta);
  const localizedString = (value: unknown): string | null => {
    const raw = stringValue(value);
    return raw ? detailDisplayTerm(content, raw, raw) : null;
  };
  const localizedList = (value: unknown): string | null => Array.isArray(value)
    ? value.map(item => {
      const raw = typeof item === "string" ? item.trim() : stringValue(record(item).name);
      return raw ? detailDisplayTerm(content, raw, raw) : null;
    }).filter(Boolean).join(" · ") || null
    : null;
  if (kind === "destination") {
    const destination = record(root.destination);
    return {
      "destination.name": localizedString(destination.name), "destination.country": localizedString(destination.country),
      "destination.shortDescription": stringValue(destination.shortDescription), "destination.description": stringValue(destination.description),
      "destination.language": localizedString(destination.language), "destination.currency": stringValue(destination.currency),
      "destination.climate": stringValue(destination.climate), "destination.livingCost": stringValue(destination.livingCost),
      "destination.visaInfo": stringValue(destination.visaInfo), "destination.workPermit": stringValue(destination.workPermit),
      "stats.universityCount": numberValue(stats.universityCount, locale), "stats.programCount": numberValue(stats.programCount, locale),
      "stats.cityCount": Array.isArray(root.cities) ? new Intl.NumberFormat(locale).format(root.cities.length) : null,
    };
  }
  if (kind === "city") {
    const facts = record(data.externalFacts);
    return {
      "city.name": localizedString(data.name), "city.country": localizedString(data.country), "city.description": stringValue(data.description),
      "city.universityCount": numberValue(data.universityCount, locale), "city.programCount": numberValue(data.programCount, locale),
      "city.programLanguages": localizedList(data.programLanguages), "city.transportModes": localizedList(data.transportModes),
      "city.campusGeography": stringValue(data.campusGeography), "city.climateSummary": stringValue(facts.climateSummary),
      "city.climateAverage": typeof facts.climateAnnualAverageC === "number" && Number.isFinite(facts.climateAnnualAverageC) ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(facts.climateAnnualAverageC)}°C` : null,
      "city.housingSummary": stringValue(facts.housingSummary), "city.housingFormats": localizedList(facts.housingFormats),
    };
  }
  if (kind === "university") {
    return {
      "university.name": localizedString(data.name), "university.country": localizedString(data.country), "university.city": localizedString(data.city),
      "university.description": stringValue(data.description), "university.type": localizedString(data.universityType), "university.address": stringValue(data.address),
      "university.website": stringValue(data.website), "university.ranking": numberValue(data.ranking, locale),
      "university.qsRanking": numberValue(data.qsRanking, locale), "university.timesRanking": numberValue(data.timesRanking, locale),
      "university.shanghaiRanking": numberValue(data.shanghaiRanking, locale), "university.leidenRanking": numberValue(data.cwtsLeidenRanking, locale),
      "stats.programCount": numberValue(meta.programCount, locale),
    };
  }
  const tuition = record(data.tuition);
  const currency = stringValue(tuition.currency) || stringValue(data.currency);
  const tuitionAmount = typeof tuition.amount === "number" ? tuition.amount : data.tuitionFee;
  return {
    "program.name": localizedString(data.name), "program.description": stringValue(data.description), "program.degree": localizedString(data.degree),
    "program.field": localizedString(data.field), "program.language": localizedString(data.language), "program.duration": localizedString(data.duration),
    "program.tuitionFee": moneyValue(tuitionAmount, currency, locale), "program.discountedFee": moneyValue(data.discountedFee, currency, locale),
    "program.scholarship": typeof data.scholarship === "number" && Number.isFinite(data.scholarship) ? `${new Intl.NumberFormat(locale).format(data.scholarship)}%` : null,
    "program.currency": currency, "program.applicationFee": moneyValue(data.applicationFee, currency, locale), "program.enrollmentFee": moneyValue(data.enrollmentFee, currency, locale),
    "program.depositFee": moneyValue(data.depositFee, currency, locale), "program.advancedFee": moneyValue(data.advancedFee, currency, locale), "program.languageFee": moneyValue(data.languageFee, currency, locale),
    "program.feeType": localizedString(data.feeType), "program.intakes": stringValue(data.intakes), "program.requirements": stringValue(data.requirements), "program.refundProcess": stringValue(data.refundProcess),
    "program.quota": numberValue(data.quota, locale), "university.name": localizedString(data.universityName), "university.country": localizedString(data.universityCountry),
    "university.city": localizedString(data.universityCity), "university.type": localizedString(data.universityType), "university.website": stringValue(data.universityWebsite),
    "university.address": stringValue(data.universityAddress), "stats.intakeCount": Array.isArray(root.intakes) ? new Intl.NumberFormat(locale).format(root.intakes.length) : null,
    "stats.relatedProgramCount": Array.isArray(root.related) ? new Intl.NumberFormat(locale).format(root.related.length) : null,
  };
}
