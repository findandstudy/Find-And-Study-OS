/** Explicit emergency stop for this module; unset preserves the deployed policy. */
export function signedContractDeliveryWorkerEnabled(
  raw = process.env.SIGNED_CONTRACT_DELIVERY_ENABLED,
): boolean {
  return raw === undefined || raw === "true";
}
