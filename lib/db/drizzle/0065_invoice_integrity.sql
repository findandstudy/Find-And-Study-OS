ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_amount_positive_chk" CHECK ("amount" > 0) NOT VALID,
  ADD CONSTRAINT "invoices_currency_chk" CHECK ("currency" ~ '^[A-Z]{3}$') NOT VALID,
  ADD CONSTRAINT "invoices_status_chk" CHECK ("status" IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')) NOT VALID;

-- NOT VALID preserves legacy rows while PostgreSQL enforces every new write.
-- Audit and normalize legacy finance data before validating these constraints.
