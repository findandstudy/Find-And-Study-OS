import type { Pool } from "pg";

/** Default-unwired budget adapter using the EXISTING persona run ledger.
 * Caller must first resolve persisted persona scope via server authorization.
 * A reservation consumes its full upper bound until separately reconciled.
 * Timeout/crash/unknown provider outcome MUST NOT release it or create a retry.
 */
export async function reservePersonaBudget(
  pool: Pick<Pool, "connect">,
  request: {
    personaId: number;
    requestKey: string;
    intentDigest: string;
    upperBoundMicros: number;
  },
): Promise<{ runId: number; replay: boolean }> {
  if (
    !Number.isSafeInteger(request.personaId) ||
    request.personaId <= 0 ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(request.requestKey) ||
    !/^[a-f0-9]{64}$/.test(request.intentDigest) ||
    !Number.isSafeInteger(request.upperBoundMicros) ||
    request.upperBoundMicros <= 0 ||
    request.upperBoundMicros > 9999999999
  )
    throw new Error("PERSONA_BUDGET_BOUND_REQUIRED");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '3s'");
    await client.query("SET LOCAL statement_timeout = '5s'");
    // Serializes ALL requests for this persona, including across worker processes.
    const persona = await client.query<{ cap: string | null }>(
      "SELECT (monthly_cost_cap_usd * 1000000)::text AS cap FROM ai_personas WHERE id = $1 AND is_active = true FOR UPDATE",
      [request.personaId],
    );
    const cap = Number(persona.rows[0]?.cap);
    if (!Number.isSafeInteger(cap) || cap <= 0)
      throw new Error("PERSONA_BUDGET_CAP_REQUIRED");
    const previous = await client.query<{
      id: number;
      digest: string;
      bound: string;
    }>(
      `SELECT id, output_payload->'budgetReservationV1'->>'intentDigest' AS digest,
       output_payload->'budgetReservationV1'->>'upperBoundMicros' AS bound
       FROM ai_persona_runs WHERE persona_id = $1
       AND output_payload->'budgetReservationV1'->>'requestKey' = $2`,
      [request.personaId, request.requestKey],
    );
    if (previous.rows.length) {
      const row = previous.rows[0];
      if (
        previous.rows.length !== 1 ||
        row.digest !== request.intentDigest ||
        Number(row.bound) !== request.upperBoundMicros
      )
        throw new Error("PERSONA_BUDGET_REPLAY_CONFLICT");
      await client.query("COMMIT");
      return { runId: row.id, replay: true };
    }
    const usage = await client.query<{ spent: string; unknown: string }>(
      `SELECT COALESCE(SUM(CASE WHEN output_payload ? 'budgetReservationV1'
         THEN (output_payload->'budgetReservationV1'->>'upperBoundMicros')::numeric
         ELSE cost_usd * 1000000 END), 0)::text AS spent,
       COUNT(*) FILTER (WHERE (cost_usd IS NULL AND NOT COALESCE(output_payload ? 'budgetReservationV1', false))
         OR cost_usd < 0 OR (output_payload ? 'budgetReservationV1' AND
           COALESCE((output_payload->'budgetReservationV1'->>'upperBoundMicros')::numeric, 0) <= 0))::text AS unknown
       FROM ai_persona_runs WHERE persona_id = $1
       AND created_at >= date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
      [request.personaId],
    );
    const spent = Number(usage.rows[0]?.spent);
    if (
      usage.rows[0]?.unknown !== "0" ||
      !Number.isSafeInteger(spent) ||
      spent < 0
    )
      throw new Error("PERSONA_BUDGET_RECONCILIATION_REQUIRED");
    if (request.upperBoundMicros > cap - spent)
      throw new Error("PERSONA_BUDGET_EXCEEDED");
    const result = await client.query<{ id: number }>(
      `INSERT INTO ai_persona_runs (persona_id, triggered_by, status, cost_usd, error_message, output_payload)
       VALUES ($1, 'manual', 'error', NULL, 'PERSONA_BUDGET_RESERVED_NOT_EXECUTED', $2::jsonb) RETURNING id`,
      [
        request.personaId,
        JSON.stringify({
          budgetReservationV1: {
            requestKey: request.requestKey,
            intentDigest: request.intentDigest,
            upperBoundMicros: request.upperBoundMicros,
            accounting: "reserved_upper_bound_not_actual_cost",
            reconciliationRequired: true,
          },
        }),
      ],
    );
    await client.query("COMMIT");
    return { runId: result.rows[0].id, replay: false };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    // DB messages can contain SQL data. Only our fixed policy codes escape.
    if (
      error instanceof Error &&
      /^PERSONA_BUDGET_[A-Z_]+$/.test(error.message)
    )
      throw error;
    throw new Error("PERSONA_BUDGET_UNAVAILABLE_RECONCILE_BEFORE_RETRY");
  } finally {
    client.release();
  }
}
