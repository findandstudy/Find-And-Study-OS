-- PREPARED ONLY. Attach to the attested Apply journal AFTER 0066_education_country.
-- Never run on staging's unrelated 144-entry migration chain.
-- No historical signed contracts are enrolled, no existing mail queue changes.
CREATE TABLE signed_contract_deliveries (
  signed_contract_id integer PRIMARY KEY REFERENCES signed_contracts(id) ON DELETE RESTRICT,
  signing_session_id integer NOT NULL REFERENCES signing_sessions(id) ON DELETE RESTRICT,
  recipient text NOT NULL CHECK (recipient = lower(btrim(recipient)) AND recipient ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  message_id text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'waiting_pdf' CHECK (state IN ('waiting_pdf','preparing','ready','sending','accepted','rejected','ambiguous','failed')),
  pdf_object_key text,
  pdf_sha256 text CHECK (pdf_sha256 ~ '^[a-f0-9]{64}$'),
  evidence_hash text,
  subject text,
  html_body text,
  text_body text,
  claim_id uuid,
  claimed_at timestamptz,
  prepare_attempts integer NOT NULL DEFAULT 0 CHECK (prepare_attempts BETWEEN 0 AND 3),
  sending_at timestamptz,
  accepted_at timestamptz,
  receipt jsonb,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state NOT IN ('ready','sending','accepted','rejected','ambiguous')) OR
    (pdf_object_key IS NOT NULL AND pdf_sha256 IS NOT NULL AND evidence_hash IS NOT NULL AND subject IS NOT NULL AND html_body IS NOT NULL AND text_body IS NOT NULL)),
  CHECK ((state <> 'accepted') OR (accepted_at IS NOT NULL AND receipt IS NOT NULL)),
  CHECK ((state NOT IN ('preparing','sending')) OR (claim_id IS NOT NULL AND claimed_at IS NOT NULL)),
  CHECK ((state <> 'sending') OR sending_at IS NOT NULL)
);
CREATE INDEX signed_contract_deliveries_state_idx ON signed_contract_deliveries(state, created_at);
--> statement-breakpoint
CREATE FUNCTION guard_signed_contract_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Contract delivery receipts cannot be deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'waiting_pdf' OR NEW.pdf_object_key IS NOT NULL OR NEW.receipt IS NOT NULL THEN
      RAISE EXCEPTION 'Contract delivery must start without an artifact or receipt';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.signed_contract_id, NEW.signing_session_id, NEW.recipient, NEW.message_id, NEW.created_at)
     IS DISTINCT FROM (OLD.signed_contract_id, OLD.signing_session_id, OLD.recipient, OLD.message_id, OLD.created_at) THEN
    RAISE EXCEPTION 'Contract delivery identity is immutable';
  END IF;
  IF OLD.pdf_object_key IS NOT NULL AND
     (NEW.pdf_object_key, NEW.pdf_sha256, NEW.evidence_hash, NEW.subject, NEW.html_body, NEW.text_body)
     IS DISTINCT FROM (OLD.pdf_object_key, OLD.pdf_sha256, OLD.evidence_hash, OLD.subject, OLD.html_body, OLD.text_body) THEN
    RAISE EXCEPTION 'Contract attachment and email content are immutable';
  END IF;
  IF NEW.state <> OLD.state AND NOT (
    (OLD.state = 'waiting_pdf' AND NEW.state = 'preparing') OR
    (OLD.state = 'preparing' AND NEW.state IN ('waiting_pdf','ready','failed')) OR
    (OLD.state = 'ready' AND NEW.state IN ('sending','failed')) OR
    (OLD.state = 'sending' AND NEW.state IN ('accepted','rejected','ambiguous'))
  ) THEN RAISE EXCEPTION 'Invalid contract delivery transition'; END IF;
  IF OLD.state IN ('accepted','rejected','ambiguous','failed') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Final contract delivery outcome requires a separately reviewed reconciliation';
  END IF;
  IF NEW.state = 'accepted' AND (NEW.receipt->>'recipient' IS DISTINCT FROM NEW.recipient
    OR NEW.receipt->>'messageId' IS DISTINCT FROM NEW.message_id
    OR COALESCE(NEW.receipt->>'responseSha256','') !~ '^[a-f0-9]{64}$') THEN
    RAISE EXCEPTION 'Exact SMTP acceptance receipt required';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER signed_contract_delivery_guard BEFORE INSERT OR UPDATE OR DELETE ON signed_contract_deliveries
  FOR EACH ROW EXECUTE FUNCTION guard_signed_contract_delivery();
