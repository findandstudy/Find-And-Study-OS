-- Bounded system-history exclusion and last-mile intent lookup use the mail queue id.
CREATE INDEX pipeline_stage_email_dispatch_queue_idx ON pipeline_stage_email_dispatches(email_queue_id);
