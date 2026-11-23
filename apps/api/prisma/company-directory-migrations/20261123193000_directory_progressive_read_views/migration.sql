ALTER TABLE company_directory.company_snapshots
  ADD COLUMN IF NOT EXISTS storage_snapshot_id TEXT,
  ADD COLUMN IF NOT EXISTS storage_max_cnpj VARCHAR(14);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='company_snapshots_progressive_storage_fkey' AND conrelid='company_directory.company_snapshots'::regclass) THEN
    ALTER TABLE company_directory.company_snapshots ADD CONSTRAINT company_snapshots_progressive_storage_fkey
      FOREIGN KEY (storage_snapshot_id) REFERENCES company_directory.company_snapshots(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='company_snapshots_progressive_storage_check' AND conrelid='company_directory.company_snapshots'::regclass) THEN
    ALTER TABLE company_directory.company_snapshots ADD CONSTRAINT company_snapshots_progressive_storage_check CHECK (
      (storage_snapshot_id IS NULL AND storage_max_cnpj IS NULL) OR
      (storage_snapshot_id IS NOT NULL AND storage_max_cnpj IS NOT NULL AND storage_snapshot_id<>id AND storage_max_cnpj ~ '^[A-Z0-9]{12}[0-9]{2}$')
    );
  END IF;
END $$;
