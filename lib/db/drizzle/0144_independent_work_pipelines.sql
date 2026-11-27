-- Independent work pipelines; additive schema, no CRM backfill.
-- No existing CRM tables, stages, or application statuses are changed.
-- Existing inbox upsert requires this key. No rows are deleted or merged;
-- conflicting historical duplicates make the migration fail for review.
CREATE UNIQUE INDEX IF NOT EXISTS conversation_participants_conversation_user_unique
  ON public.conversation_participants(conversation_id,user_id);
CREATE SCHEMA IF NOT EXISTS local_work_pipelines;
CREATE TABLE IF NOT EXISTS local_work_pipelines.boards (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  document jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id,id)
);
CREATE TABLE IF NOT EXISTS local_work_pipelines.cards (
  tenant_id uuid NOT NULL,
  board_id uuid NOT NULL,
  id uuid NOT NULL,
  document jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  source_kind text,
  source_key text,
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,board_id) REFERENCES local_work_pipelines.boards(tenant_id,id),
  UNIQUE(tenant_id,board_id,source_kind,source_key)
);
CREATE INDEX IF NOT EXISTS work_cards_board ON local_work_pipelines.cards(tenant_id,board_id);
CREATE TABLE IF NOT EXISTS local_work_pipelines.sources (
  tenant_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('channel','embed','web')),
  source_key text NOT NULL,
  board_id uuid NOT NULL,
  PRIMARY KEY(tenant_id,kind,source_key),
  FOREIGN KEY(tenant_id,board_id) REFERENCES local_work_pipelines.boards(tenant_id,id)
);
ALTER TABLE local_work_pipelines.boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_work_pipelines.boards FORCE ROW LEVEL SECURITY;
ALTER TABLE local_work_pipelines.cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_work_pipelines.cards FORCE ROW LEVEL SECURITY;
ALTER TABLE local_work_pipelines.sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_work_pipelines.sources FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='local_work_pipelines' AND tablename='boards' AND policyname='tenant_boundary') THEN
    CREATE POLICY tenant_boundary ON local_work_pipelines.boards USING(tenant_id::text=current_setting('app.work_pipeline_tenant',true)) WITH CHECK(tenant_id::text=current_setting('app.work_pipeline_tenant',true));
    CREATE POLICY tenant_boundary ON local_work_pipelines.cards USING(tenant_id::text=current_setting('app.work_pipeline_tenant',true)) WITH CHECK(tenant_id::text=current_setting('app.work_pipeline_tenant',true));
    CREATE POLICY tenant_boundary ON local_work_pipelines.sources USING(tenant_id::text=current_setting('app.work_pipeline_tenant',true)) WITH CHECK(tenant_id::text=current_setting('app.work_pipeline_tenant',true));
  END IF;
END $$;
GRANT USAGE ON SCHEMA local_work_pipelines TO fas_app;
GRANT SELECT,INSERT,UPDATE ON local_work_pipelines.boards,local_work_pipelines.cards TO fas_app;
GRANT SELECT,INSERT,DELETE ON local_work_pipelines.sources TO fas_app;
-- PostgreSQL requires UPDATE privilege for FOR SHARE. The restrictive policy
-- allows locking but rejects every actual source UPDATE; changes use delete/insert.
GRANT UPDATE ON local_work_pipelines.sources TO fas_app;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='local_work_pipelines' AND tablename='sources' AND policyname='no_source_update') THEN
  CREATE POLICY no_source_update ON local_work_pipelines.sources AS RESTRICTIVE FOR UPDATE USING(true) WITH CHECK(false);
 END IF;
END $$;
