ALTER TABLE pipeline_notice_dispatches
  ADD COLUMN transition_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN origin_txid text,
  ADD COLUMN journey_key text,
  ADD COLUMN event_binding_hash text,
  ADD COLUMN attempts smallint NOT NULL DEFAULT 0,
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
DO $$
DECLARE previous_unique name;
BEGIN
  SELECT conname INTO STRICT previous_unique
  FROM pg_constraint WHERE conrelid = 'pipeline_notice_dispatches'::regclass AND contype = 'u';
  EXECUTE format('ALTER TABLE pipeline_notice_dispatches DROP CONSTRAINT %I', previous_unique);
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX pipeline_notice_transition_channel_uq ON pipeline_notice_dispatches(transition_id, channel);
--> statement-breakpoint
CREATE INDEX pipeline_notice_record_transition_idx
  ON pipeline_notice_dispatches(entity_kind, entity_id, channel, id DESC);
--> statement-breakpoint
CREATE INDEX pipeline_notice_journey_transition_idx
  ON pipeline_notice_dispatches(origin_txid, journey_key, channel) WHERE journey_key IS NOT NULL;
--> statement-breakpoint
-- Earlier queued rows have no authoritative event-time recipient binding.
-- Preserve receipts and let the delivery preflight reject unbound queue items.
UPDATE pipeline_notice_dispatches
SET status='skipped', error_code='NOTICE_EVENT_BINDING_MISSING', updated_at=now()
WHERE status='queued' AND tenant_id IS NULL;
--> statement-breakpoint
CREATE FUNCTION pipeline_notice_event_binding(kind text, entity text, scope_tenant uuid, scope_board uuid)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE record_data jsonb; subject jsonb; source_agent jsonb; agent_user integer; staff_user integer;
  subject_user integer; user_receipts jsonb; board_members jsonb;
BEGIN
  IF kind = 'work' THEN
    SELECT k.document, b.document->'memberIds' INTO record_data, board_members
      FROM local_work_pipelines.cards k
      JOIN local_work_pipelines.boards b ON b.tenant_id=k.tenant_id AND b.id=k.board_id
      WHERE k.tenant_id=scope_tenant AND k.board_id=scope_board AND k.id::text=entity;
    IF record_data IS NULL THEN RETURN NULL; END IF;
    subject := jsonb_build_object('email',record_data->'email','phone',record_data->'phone','source',record_data->'source');
    staff_user := (record_data->>'assigneeId')::integer;
    record_data := NULL;
  ELSIF kind = 'application' THEN
    SELECT jsonb_build_object('studentId',student_id,'agentId',agent_id,'assigneeId',assigned_to_id,'branchId',branch_id,'source',created_source)
      INTO record_data FROM applications WHERE id=entity::integer AND deleted_at IS NULL;
    SELECT jsonb_build_object('id',id,'email',email,'phone',phone,'phoneE164',phone_e164,'userId',user_id,'agentId',agent_id,'branchId',branch_id)
      INTO subject FROM students WHERE id=(record_data->>'studentId')::integer AND deleted_at IS NULL;
  ELSIF kind = 'student' THEN
    SELECT jsonb_build_object('id',id,'email',email,'phone',phone,'phoneE164',phone_e164,'userId',user_id,
      'agentId',agent_id,'assigneeId',assigned_to_id,'branchId',branch_id)
      INTO subject FROM students WHERE id=entity::integer AND deleted_at IS NULL;
  ELSIF kind = 'lead' THEN
    SELECT jsonb_build_object('id',id,'email',email,'phone',phone,'phoneE164',phone_e164,
      'studentId',converted_student_id,'agentId',agent_id,'assigneeId',assigned_to_id,'branchId',branch_id)
      INTO subject FROM leads WHERE id=entity::integer AND deleted_at IS NULL;
  END IF;
  IF subject IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_build_object('id',id,'userId',user_id,'parentId',parent_agent_id,'email',email,
      'phone',phone,'phoneE164',phone_e164,'status',status,'deletedAt',deleted_at), user_id
    INTO source_agent, agent_user FROM agents
    WHERE id=COALESCE((record_data->>'agentId')::integer, (subject->>'agentId')::integer);
  staff_user := COALESCE(staff_user, (record_data->>'assigneeId')::integer, (subject->>'assigneeId')::integer);
  subject_user := (subject->>'userId')::integer;
  SELECT jsonb_agg(receipt ORDER BY id) INTO user_receipts FROM (
    SELECT id, jsonb_build_object('id',id,'email',email,'phone',phone,'phoneE164',phone_e164,
      'active',is_active,'verified',email_verified,'deletedAt',deleted_at,'role',role,
      'preferences',notification_preferences) receipt
    FROM users
    WHERE id IN (staff_user, agent_user, subject_user) OR
      (subject_user IS NULL AND lower(trim(email))=lower(trim(subject->>'email')) AND is_active AND deleted_at IS NULL AND email_verified)
    ORDER BY id LIMIT 6
  ) receipts;
  RETURN encode(sha256(convert_to(jsonb_build_array(record_data,subject,source_agent,user_receipts,board_members)::text,'UTF8')),'hex');
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enqueue_pipeline_notice_v2() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k text; eid text; sk text; oldsk text; tid uuid; bid uuid; policies jsonb;
  pol jsonb; ch text; transition uuid; binding text; journey text;
BEGIN
  IF TG_TABLE_SCHEMA='local_work_pipelines' AND TG_TABLE_NAME='cards' THEN
    k:='work'; eid:=NEW.id::text; sk:=NEW.document->>'stageId'; tid:=NEW.tenant_id; bid:=NEW.board_id;
    IF TG_OP='UPDATE' THEN oldsk:=OLD.document->>'stageId'; END IF;
    IF oldsk IS NOT DISTINCT FROM sk THEN RETURN NEW; END IF;
    SELECT jsonb_build_object('email',st->'automaticEmail','whatsapp',st->'automaticMessage') INTO policies
      FROM local_work_pipelines.boards b CROSS JOIN LATERAL jsonb_array_elements(b.document->'stages') st
      WHERE b.tenant_id=tid AND b.id=bid AND b.document->>'archived'='false' AND st->>'id'=sk LIMIT 1;
  ELSE
    k:=CASE TG_TABLE_NAME WHEN 'leads' THEN 'lead' WHEN 'students' THEN 'student' WHEN 'applications' THEN 'application' ELSE NULL END;
    IF k IS NULL OR NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
    eid:=NEW.id::text;
    sk:=CASE WHEN k='application' THEN to_jsonb(NEW)->>'stage' ELSE to_jsonb(NEW)->>'status' END;
    IF TG_OP='UPDATE' THEN oldsk:=CASE WHEN k='application' THEN to_jsonb(OLD)->>'stage' ELSE to_jsonb(OLD)->>'status' END; END IF;
    IF oldsk IS NOT DISTINCT FROM sk THEN RETURN NEW; END IF;
    journey := CASE k WHEN 'application' THEN 'student:' || (to_jsonb(NEW)->>'student_id')
      WHEN 'student' THEN 'student:' || eid
      WHEN 'lead' THEN 'student:' || (to_jsonb(NEW)->>'converted_student_id') END;
    SELECT jsonb_build_object('email',automatic_email,'whatsapp',automatic_message) INTO policies
      FROM pipeline_stages WHERE entity_type=k AND key=sk LIMIT 1;
  END IF;
  IF policies IS NULL OR sk IS NULL OR length(sk) NOT BETWEEN 1 AND 160 OR NOT (
    COALESCE(policies->'email'->'enabled'='true'::jsonb AND policies->'email'->>'policyVersion'='2',false) OR
    COALESCE(policies->'whatsapp'->'enabled'='true'::jsonb AND policies->'whatsapp'->>'policyVersion'='2',false)
  ) THEN RETURN NEW; END IF;
  transition := gen_random_uuid();
  binding := pipeline_notice_event_binding(k,eid,tid,bid);
  FOREACH ch IN ARRAY ARRAY['email','whatsapp'] LOOP
    pol := policies->ch;
    IF pol->'enabled'='true'::jsonb AND pol->>'policyVersion'='2' THEN
      INSERT INTO pipeline_notice_dispatches(entity_kind,entity_id,tenant_id,board_id,stage_key,channel,policy,sender_revision,
        transition_id,origin_txid,journey_key,event_binding_hash)
      VALUES(k,eid,tid,bid,sk,ch,pol,CASE WHEN ch='email' AND pol->>'senderAccountId' ~ '^[1-9][0-9]{0,8}$' THEN (
        SELECT CASE WHEN metadata->'emailSender'->>'revision' ~ '^[1-9][0-9]{0,8}$' THEN (metadata->'emailSender'->>'revision')::integer END
        FROM channel_accounts WHERE id=(pol->>'senderAccountId')::integer) END,
        transition,pg_current_xact_id()::text,journey,binding);
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
