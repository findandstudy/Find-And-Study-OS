import { types as utilTypes } from "node:util";

import type {
  Pool,
  PoolClient,
  QueryConfig,
  QueryResult,
  QueryResultRow,
} from "pg";

import type {
  PublicWebDraftSourceBinding,
} from "./publicWebDraftIntakeBuilder.js";
import {
  PUBLIC_WEB_ENTITY_TYPES,
  type PublicWebEntityType,
} from "./publicWebContentContract.js";

const EXACT_EXECUTOR_ROLE = "fas_public_web_executor";
const MAX_ENTITY_ID = 2_147_483_647;
const EXECUTOR_CRITICAL_RELATIONS = [
  "public.users",
  "public.sessions",
  "public.active_session_context_selections",
  "public.tenants",
  "public.organizations",
  "public.principals",
  "public.memberships",
  "public.policy_versions",
  "public.access_assignments",
  "public.role_definitions",
  "public.role_package_versions",
  "public.role_package_capabilities",
  "public.capability_definitions",
  "public.access_decision_receipts",
  "public.public_web_content_records",
  "public.public_web_content_revisions",
  "public.public_web_publication_states",
  "public.public_web_route_aliases",
  "public.public_web_draft_intake_receipts",
  "public.programs",
  "public.universities",
  "public.destinations",
  "public.cities",
  "public.countries",
  "public.website_pages",
  "public.website_blog_posts",
] as const;
const SHA256_RE = /^[0-9a-f]{64}$/;
const MAX_OPERATION_DURATION_MS = 5_000;
const MAX_IDLE_IN_TRANSACTION_TIMEOUT_MS = 5_000;
const DEADLINE_REACHED = Object.freeze({ kind: "deadline" as const });

const abortSignalAbortedGetter = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  "aborted",
)?.get;
const addEventListener = EventTarget.prototype.addEventListener;
const removeEventListener = EventTarget.prototype.removeEventListener;

export type PostgresPublicWebDraftSourceResolverContext = Readonly<{
  signal: AbortSignal;
  deadlineAt: number;
}>;

export type PostgresPublicWebDraftSourceResolverOptions = {
  pool: Pool;
  expectedRole?: typeof EXACT_EXECUTOR_ROLE;
};

type ResolverContextSnapshot = Readonly<{
  signal?: AbortSignal;
  deadlineAt: number;
}>;

function isNativeAbortSignal(value: unknown): value is AbortSignal {
  if (
    value === null ||
    typeof value !== "object" ||
    utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== AbortSignal.prototype ||
    typeof abortSignalAbortedGetter !== "function"
  ) {
    return false;
  }
  try {
    Reflect.apply(abortSignalAbortedGetter, value, []);
    return true;
  } catch {
    return false;
  }
}

function snapshotResolverContext(
  value: PostgresPublicWebDraftSourceResolverContext | undefined,
  startedAt: number,
): ResolverContextSnapshot {
  if (value === undefined) {
    return Object.freeze({ deadlineAt: startedAt + MAX_OPERATION_DURATION_MS });
  }
  if (
    value === null ||
    typeof value !== "object" ||
    utilTypes.isProxy(value) ||
    Array.isArray(value)
  ) {
    throw new Error("public_web_draft_source_context_invalid");
  }
  let prototype: object | null;
  let ownKeys: PropertyKey[];
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Object.getPrototypeOf(value);
    ownKeys = Reflect.ownKeys(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new Error("public_web_draft_source_context_invalid");
  }
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    ownKeys.length !== 2 ||
    ownKeys.some((key) => typeof key !== "string") ||
    !ownKeys.includes("deadlineAt") ||
    !ownKeys.includes("signal")
  ) {
    throw new Error("public_web_draft_source_context_invalid");
  }
  const deadlineDescriptor = descriptors.deadlineAt;
  const signalDescriptor = descriptors.signal;
  if (
    !deadlineDescriptor ||
    !("value" in deadlineDescriptor) ||
    deadlineDescriptor.enumerable !== true ||
    !signalDescriptor ||
    !("value" in signalDescriptor) ||
    signalDescriptor.enumerable !== true ||
    !Number.isSafeInteger(deadlineDescriptor.value) ||
    deadlineDescriptor.value < 0 ||
    !isNativeAbortSignal(signalDescriptor.value)
  ) {
    throw new Error("public_web_draft_source_context_invalid");
  }
  return Object.freeze({
    signal: signalDescriptor.value,
    deadlineAt: Math.min(
      deadlineDescriptor.value,
      startedAt + MAX_OPERATION_DURATION_MS,
    ),
  });
}

function isSignalAborted(signal: AbortSignal): boolean {
  try {
    return Reflect.apply(abortSignalAbortedGetter!, signal, []) === true;
  } catch {
    return true;
  }
}

class ResolverDeadline {
  readonly reached: Promise<typeof DEADLINE_REACHED>;
  readonly error = new Error("public_web_draft_source_deadline_exceeded");

  private readonly deadlineAt: number;
  private readonly signal?: AbortSignal;
  private readonly callbacks = new Set<() => void>();
  private readonly resolveReached: () => void;
  private readonly abortListener: () => void;
  private timer: NodeJS.Timeout | undefined;
  private exceeded = false;
  private closed = false;

  constructor(context: ResolverContextSnapshot) {
    this.deadlineAt = context.deadlineAt;
    this.signal = context.signal;
    let resolveReached!: (value: typeof DEADLINE_REACHED) => void;
    this.reached = new Promise((resolve) => {
      resolveReached = resolve;
    });
    this.resolveReached = () => resolveReached(DEADLINE_REACHED);
    this.abortListener = () => this.exceed();

    if (this.signal && isSignalAborted(this.signal)) {
      this.exceed();
      return;
    }
    const remainingMs = this.deadlineAt - Date.now();
    if (!Number.isSafeInteger(remainingMs) || remainingMs <= 0) {
      this.exceed();
      return;
    }
    if (this.signal) {
      try {
        Reflect.apply(addEventListener, this.signal, [
          "abort",
          this.abortListener,
          { once: true },
        ]);
      } catch {
        this.exceed();
        return;
      }
      if (isSignalAborted(this.signal)) {
        this.exceed();
        return;
      }
    }
    this.timer = setTimeout(this.abortListener, remainingMs);
    this.timer.unref?.();
  }

  isExceeded(): boolean {
    if (
      !this.exceeded &&
      (Date.now() >= this.deadlineAt || (this.signal && isSignalAborted(this.signal)))
    ) {
      this.exceed();
    }
    return this.exceeded;
  }

  throwIfExceeded(): void {
    if (this.isExceeded()) throw this.error;
  }

  remainingMs(): number {
    this.throwIfExceeded();
    const remainingMs = this.deadlineAt - Date.now();
    if (!Number.isSafeInteger(remainingMs) || remainingMs <= 0) {
      this.exceed();
      throw this.error;
    }
    return Math.max(1, Math.min(MAX_OPERATION_DURATION_MS, remainingMs));
  }

  onExceeded(callback: () => void): () => void {
    if (this.isExceeded()) {
      callback();
      return () => undefined;
    }
    this.callbacks.add(callback);
    return () => {
      this.callbacks.delete(callback);
    };
  }

  exceed(): void {
    if (this.exceeded || this.closed) return;
    this.exceeded = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.resolveReached();
    for (const callback of this.callbacks) {
      try {
        callback();
      } catch {
        // Deadline enforcement must not surface an event-listener exception.
      }
    }
    this.callbacks.clear();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.callbacks.clear();
    if (this.signal) {
      try {
        Reflect.apply(removeEventListener, this.signal, [
          "abort",
          this.abortListener,
        ]);
      } catch {
        // The signal was already validated; cleanup is best effort only.
      }
    }
  }
}

type TimedQueryConfig<I extends unknown[] = unknown[]> = QueryConfig<I> & {
  query_timeout: number;
};

type QueryOutcome<R extends QueryResultRow> =
  | Readonly<{ kind: "result"; result: QueryResult<R> }>
  | Readonly<{ kind: "error"; error: unknown }>;

async function queryWithDeadline<R extends QueryResultRow = QueryResultRow>(
  client: Pick<PoolClient, "query">,
  deadline: ResolverDeadline,
  text: string,
  values?: unknown[],
): Promise<QueryResult<R>> {
  const queryTimeout = deadline.remainingMs();
  const config: TimedQueryConfig = {
    text,
    query_timeout: queryTimeout,
    ...(values === undefined ? {} : { values }),
  };
  let queryPromise: Promise<QueryResult<R>>;
  try {
    queryPromise = client.query<R>(config);
  } catch (error) {
    deadline.throwIfExceeded();
    throw error;
  }
  const observed: Promise<QueryOutcome<R>> = queryPromise.then(
    (result) => ({ kind: "result", result }),
    (error) => ({ kind: "error", error }),
  );
  const outcome: QueryOutcome<R> | typeof DEADLINE_REACHED = await Promise.race([
    observed,
    deadline.reached.then(() => DEADLINE_REACHED),
  ]);
  if (outcome.kind === "deadline") throw deadline.error;
  if (outcome.kind === "error") {
    if (
      outcome.error instanceof Error &&
      outcome.error.message === "Query read timeout"
    ) {
      deadline.exceed();
      throw deadline.error;
    }
    deadline.throwIfExceeded();
    throw outcome.error;
  }
  deadline.throwIfExceeded();
  return outcome.result;
}

function releaseLateClient(client: PoolClient, error: Error): void {
  try {
    client.release(error);
  } catch {
    // A timed-out acquisition must never re-enter the pool.
  }
}

async function connectWithDeadline(
  pool: Pool,
  deadline: ResolverDeadline,
): Promise<PoolClient> {
  deadline.throwIfExceeded();
  let connectPromise: Promise<PoolClient>;
  try {
    connectPromise = pool.connect();
  } catch (error) {
    deadline.throwIfExceeded();
    throw error;
  }
  const observed = connectPromise.then(
    (client) => {
      if (deadline.isExceeded()) {
        releaseLateClient(client, deadline.error);
        return DEADLINE_REACHED;
      }
      return { kind: "client" as const, client };
    },
    (error) => ({ kind: "error" as const, error }),
  );
  const outcome = await Promise.race([
    observed,
    deadline.reached.then(() => DEADLINE_REACHED),
  ]);
  if (outcome.kind === "deadline") throw deadline.error;
  if (outcome.kind === "error") {
    deadline.throwIfExceeded();
    throw outcome.error;
  }
  deadline.throwIfExceeded();
  return outcome.client;
}

async function rollback(
  client: PoolClient,
  deadline: ResolverDeadline,
): Promise<Error | undefined> {
  try {
    await queryWithDeadline(client, deadline, "ROLLBACK");
    return undefined;
  } catch (error) {
    return error instanceof Error
      ? error
      : new Error("public_web_draft_source_rollback_failed");
  }
}

type SourceHashRow = QueryResultRow & { source_sha256: unknown };

async function resolveSourceHash(
  client: Pick<PoolClient, "query">,
  deadline: ResolverDeadline,
  entityType: PublicWebEntityType,
  entityId: number,
): Promise<PublicWebDraftSourceBinding | null> {
  const result = await queryWithDeadline<SourceHashRow>(
    client,
    deadline,
    `SELECT fas_public_web_v1.resolve_source_sha256($1::text, $2::integer)
       AS source_sha256`,
    [entityType, entityId],
  );
  if (result.rowCount !== 1) {
    throw new Error("public_web_draft_source_result_invalid");
  }
  const sourceSha256 = result.rows[0]?.source_sha256;
  if (sourceSha256 === null) return null;
  if (typeof sourceSha256 !== "string" || !SHA256_RE.test(sourceSha256)) {
    throw new Error("public_web_draft_source_result_invalid");
  }
  return { entityType, entityId, sourceSha256 };
}

export class PostgresPublicWebDraftSourceResolver {
  private readonly pool: Pool;
  private readonly expectedRole: string;

  constructor(options: PostgresPublicWebDraftSourceResolverOptions) {
    if (
      !options?.pool ||
      (options.expectedRole !== undefined && options.expectedRole !== EXACT_EXECUTOR_ROLE)
    ) {
      throw new Error("public_web_draft_source_configuration_invalid");
    }
    this.pool = options.pool;
    this.expectedRole = options.expectedRole ?? EXACT_EXECUTOR_ROLE;
  }

  async resolve(
    entityType: PublicWebEntityType,
    entityId: number,
    context?: PostgresPublicWebDraftSourceResolverContext,
  ): Promise<PublicWebDraftSourceBinding | null> {
    if (
      !PUBLIC_WEB_ENTITY_TYPES.includes(entityType) ||
      !Number.isSafeInteger(entityId) ||
      entityId < 1 ||
      entityId > MAX_ENTITY_ID
    ) {
      throw new Error("public_web_draft_source_input_invalid");
    }
    const startedAt = Date.now();
    const contextSnapshot = snapshotResolverContext(context, startedAt);
    const deadline = new ResolverDeadline(contextSnapshot);
    let client: PoolClient;
    try {
      client = await connectWithDeadline(this.pool, deadline);
    } catch (error) {
      deadline.close();
      throw error instanceof Error
        ? error
        : new Error("public_web_draft_source_failed");
    }
    let released = false;
    let releaseFailure: Error | undefined;
    const releaseOnce = (error?: Error) => {
      if (released) return;
      released = true;
      try {
        client.release(error);
      } catch (releaseError) {
        releaseFailure = releaseError instanceof Error
          ? releaseError
          : new Error("public_web_draft_source_release_failed");
      }
    };
    const stopDeadlineRelease = deadline.onExceeded(() => {
      releaseOnce(deadline.error);
    });
    let transactionStarted = false;
    let releaseError: Error | undefined;
    try {
      const identity = await queryWithDeadline<{
        current_user: string;
        rolsuper: boolean;
        rolcreatedb: boolean;
        rolcreaterole: boolean;
        rolinherit: boolean;
        rolreplication: boolean;
        rolbypassrls: boolean;
        rolcanlogin: boolean;
        has_role_membership: boolean;
        can_execute_safe_source: boolean;
        can_execute_v1: boolean;
        can_execute_authority_helper: boolean;
        can_execute_source_internal: boolean;
        can_execute_source_locked: boolean;
        can_create_public_schema: boolean;
        can_create_facade_schema: boolean;
        has_critical_table_dml: boolean;
        tenant_setting: string | null;
        organization_setting: string | null;
      }>(client, deadline, `SELECT current_user, role.rolsuper, role.rolcreatedb,
          role.rolcreaterole, role.rolinherit, role.rolreplication,
          role.rolbypassrls, role.rolcanlogin,
          EXISTS (
            SELECT 1 FROM pg_auth_members membership
            WHERE membership.member = role.oid
          ) AS has_role_membership,
          has_function_privilege(current_user,
            'fas_public_web_v1.resolve_source_sha256(text,integer)',
            'EXECUTE') AS can_execute_safe_source,
          has_function_privilege(current_user,
            'fas_public_web_v1.apply_authorized_draft_intake(jsonb,jsonb)',
            'EXECUTE') AS can_execute_v1,
          has_function_privilege(current_user,
            'fas_public_web_v1.assert_current_draft_authority(jsonb,jsonb,jsonb)',
            'EXECUTE') AS can_execute_authority_helper,
          has_function_privilege(current_user,
            'fas_public_web_v1.resolve_source_sha256_internal(text,integer,boolean)',
            'EXECUTE') AS can_execute_source_internal,
          has_function_privilege(current_user,
            'fas_public_web_v1.resolve_source_sha256_locked(text,integer)',
            'EXECUTE') AS can_execute_source_locked,
          has_schema_privilege(current_user, 'public', 'CREATE')
            AS can_create_public_schema,
          has_schema_privilege(current_user, 'fas_public_web_v1', 'CREATE')
            AS can_create_facade_schema,
          EXISTS (
            SELECT 1
            FROM unnest($1::text[]) AS critical(relation_name)
            WHERE has_table_privilege(
              current_user,
              critical.relation_name,
              'SELECT,INSERT,UPDATE,DELETE'
            )
          ) AS has_critical_table_dml,
          nullif(current_setting('app.tenant_id', true), '') AS tenant_setting,
          nullif(current_setting('app.organization_id', true), '') AS organization_setting
        FROM pg_roles role WHERE role.rolname = current_user`, [
        EXECUTOR_CRITICAL_RELATIONS,
      ]);
      if (
        identity.rowCount !== 1 ||
        identity.rows[0]?.current_user !== this.expectedRole ||
        identity.rows[0]?.rolsuper !== false ||
        identity.rows[0]?.rolcreatedb !== false ||
        identity.rows[0]?.rolcreaterole !== false ||
        identity.rows[0]?.rolinherit !== false ||
        identity.rows[0]?.rolreplication !== false ||
        identity.rows[0]?.rolbypassrls !== false ||
        identity.rows[0]?.rolcanlogin !== true ||
        identity.rows[0]?.has_role_membership !== false ||
        identity.rows[0]?.can_execute_safe_source !== true ||
        identity.rows[0]?.can_execute_v1 !== false ||
        identity.rows[0]?.can_execute_authority_helper !== false ||
        identity.rows[0]?.can_execute_source_internal !== false ||
        identity.rows[0]?.can_execute_source_locked !== false ||
        identity.rows[0]?.can_create_public_schema !== false ||
        identity.rows[0]?.can_create_facade_schema !== false ||
        identity.rows[0]?.has_critical_table_dml !== false ||
        identity.rows[0]?.tenant_setting !== null ||
        identity.rows[0]?.organization_setting !== null
      ) {
        throw new Error("public_web_draft_source_executor_identity_invalid");
      }
      await queryWithDeadline(client, deadline, "BEGIN READ ONLY");
      transactionStarted = true;
      const remainingForTransaction = deadline.remainingMs();
      await queryWithDeadline(
        client,
        deadline,
        `SELECT set_config('lock_timeout', '1500ms', true),
                set_config('statement_timeout', $1::text, true),
                set_config('idle_in_transaction_session_timeout', $2::text, true)`,
        [
          `${Math.min(MAX_OPERATION_DURATION_MS, remainingForTransaction)}ms`,
          `${Math.min(MAX_IDLE_IN_TRANSACTION_TIMEOUT_MS, remainingForTransaction)}ms`,
        ],
      );
      const source = await resolveSourceHash(client, deadline, entityType, entityId);
      await queryWithDeadline(client, deadline, "COMMIT");
      transactionStarted = false;
      deadline.throwIfExceeded();
      return source;
    } catch (error) {
      if (transactionStarted && !released && !deadline.isExceeded()) {
        releaseError = await rollback(client, deadline);
        transactionStarted = false;
      }
      throw error instanceof Error
        ? error
        : new Error("public_web_draft_source_failed");
    } finally {
      stopDeadlineRelease();
      deadline.close();
      releaseOnce(releaseError);
      if (releaseFailure && !deadline.isExceeded()) throw releaseFailure;
    }
  }
}
