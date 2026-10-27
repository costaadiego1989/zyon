-- Refuse ambiguous historical money instead of deleting duplicate obligations.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM marketplace_settlements GROUP BY line_item_id HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'marketplace_duplicate_settlements_require_reconciliation';
  END IF;
END $$;
-- The verified schema can already contain this index before this pending
-- migration is recorded. Accept only the exact immediate unique invariant.
DO $$
DECLARE
  target_table OID := 'marketplace_settlements'::regclass;
  target_schema OID;
  target_column SMALLINT;
  existing_index OID;
BEGIN
  SELECT relnamespace INTO target_schema FROM pg_class WHERE oid = target_table;
  SELECT attnum INTO target_column FROM pg_attribute
    WHERE attrelid = target_table AND attname = 'line_item_id' AND NOT attisdropped;
  SELECT oid INTO existing_index FROM pg_class
    WHERE relnamespace = target_schema AND relname = 'marketplace_settlements_line_item_id_key';

  IF existing_index IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_index
      WHERE indexrelid = existing_index AND indrelid = target_table
        AND indisunique AND indisvalid AND indisready AND indimmediate
        AND indpred IS NULL AND indexprs IS NULL
        AND indnkeyatts = 1 AND indnatts = 1 AND indkey[0] = target_column
    ) THEN
      RAISE EXCEPTION 'marketplace_settlement_index_incompatible';
    END IF;
  ELSE
    CREATE UNIQUE INDEX "marketplace_settlements_line_item_id_key"
      ON "marketplace_settlements"("line_item_id");
  END IF;
END $$;
