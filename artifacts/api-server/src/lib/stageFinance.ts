const POTENTIAL_STAGES = [
  "inquiry", "documents_collected", "app_fee_paid", "submitted",
  "missing_docs", "awaiting_offer", "offer_received", "upload_payment",
  "awaiting_final", "final_acceptance", "acceptance_letter",
  "visa_applied", "visa_approved", "student_card",
];

const CONFIRMED_STAGE = "enrolled";

const EXCLUDED_COMMISSION_STAGES = [
  "rejected", "all_registered", "cancelled", "visa_reject", "refound", "100scholar",
];

const EXCLUDED_SERVICE_FEE_STAGES = [
  "rejected", "all_registered", "cancelled", "refound",
];

const CONFIRMED_SERVICE_FEE_STAGES = ["100scholar", "visa_reject"];

export function getCommissionFinanceStatus(stage: string): "potential" | "confirmed" | "excluded" {
  if (POTENTIAL_STAGES.includes(stage)) return "potential";
  if (stage === CONFIRMED_STAGE) return "confirmed";
  if (EXCLUDED_COMMISSION_STAGES.includes(stage)) return "excluded";
  return "potential";
}

export function getServiceFeeFinanceStatus(stage: string): "potential" | "confirmed" | "excluded" {
  if (POTENTIAL_STAGES.includes(stage)) return "potential";
  if (stage === CONFIRMED_STAGE) return "confirmed";
  if (CONFIRMED_SERVICE_FEE_STAGES.includes(stage)) return "confirmed";
  if (EXCLUDED_SERVICE_FEE_STAGES.includes(stage)) return "excluded";
  return "potential";
}

export function shouldHaveCommission(stage: string): boolean {
  return !EXCLUDED_COMMISSION_STAGES.includes(stage);
}

export function shouldHaveServiceFee(stage: string): boolean {
  return !EXCLUDED_SERVICE_FEE_STAGES.includes(stage);
}
