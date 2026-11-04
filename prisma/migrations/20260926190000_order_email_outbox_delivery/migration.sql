ALTER TABLE "notification_outbox"
  ADD COLUMN "admin_email_sent_at" TIMESTAMPTZ,
  ADD COLUMN "customer_email_sent_at" TIMESTAMPTZ;
