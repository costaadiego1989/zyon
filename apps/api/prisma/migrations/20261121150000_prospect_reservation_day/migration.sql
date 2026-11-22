ALTER TABLE outreach_attempts ADD COLUMN reservation_day varchar(10);
UPDATE outreach_attempts SET reservation_day=to_char(created_at,'YYYY-MM-DD') WHERE recipient_id IS NOT NULL;
ALTER TABLE outreach_attempts ADD CONSTRAINT outreach_reservation_day_format CHECK (reservation_day IS NULL OR reservation_day ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');
