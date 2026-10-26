import type { ActiveContextSessionRepository } from "./activeContextSessionGateway";

/** The normal OS asynchronously touches session expiry. PostgreSQL may reject
 * a simultaneous SERIALIZABLE session-lock read with 40001 before its callback.
 * Retry that known pre-operation conflict once, with a fresh canonical read.
 * NEVER repeat issuance/business callbacks, uncertain commits, tools or costs.
 * This is module-local: the shared repository/isolation/authority is unchanged.
 */
export function withPersonaSessionPreflight(repository: ActiveContextSessionRepository): ActiveContextSessionRepository {
  return {
    async withLockedCurrentSession(input, operation) {
      for (let attempt = 0; attempt < 2; attempt++) {
        let entered = false;
        try {
          return await repository.withLockedCurrentSession(input, async (state) => {
            // Also reject an invalid adapter that attempts duplicate invocation.
            if (entered) throw new Error("PERSONA_SESSION_CONTRACT_INVALID");
            entered = true;
            return operation(state);
          });
        } catch (error) {
          const serializationConflict = error instanceof Error && "code" in error && error.code === "40001";
          if (entered || attempt !== 0 || !serializationConflict) throw error;
        }
      }
      throw new Error("PERSONA_SESSION_CONTRACT_INVALID");
    },
  };
}
