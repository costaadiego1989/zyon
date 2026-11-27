-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "company_directory";

-- CreateTable
CREATE TABLE "company_directory"."company_snapshots" (
    "id" TEXT NOT NULL,
    "competence" VARCHAR(7) NOT NULL,
    "manifest_hash" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'discovered',
    "source_url" TEXT NOT NULL,
    "parser_version" TEXT NOT NULL,
    "counts" JSONB NOT NULL DEFAULT '{}',
    "available_filters" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rejected_count" INTEGER NOT NULL DEFAULT 0,
    "error_code" TEXT,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_directory"."active_snapshot" (
    "id" TEXT NOT NULL DEFAULT 'national',
    "snapshot_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "active_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_directory"."company_source_files" (
    "id" TEXT NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "etag" TEXT,
    "last_modified" TEXT,
    "computed_hash" TEXT,
    "compressed_bytes" BIGINT,
    "expanded_bytes" BIGINT,
    "encoding" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "committed_count" BIGINT NOT NULL DEFAULT 0,
    "rejected_count" BIGINT NOT NULL DEFAULT 0,
    "error_code" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_source_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_directory"."company_import_checkpoints" (
    "file_id" TEXT NOT NULL,
    "batch_index" INTEGER NOT NULL,
    "file_hash" TEXT NOT NULL,
    "row_offset" BIGINT NOT NULL,
    "byte_offset" BIGINT NOT NULL,
    "committed_count" INTEGER NOT NULL,
    "batch_hash" TEXT NOT NULL,
    "committed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_import_checkpoints_pkey" PRIMARY KEY ("file_id","batch_index")
);

-- CreateTable
CREATE TABLE "company_directory"."company_entities" (
    "snapshot_id" TEXT NOT NULL,
    "base_cnpj" VARCHAR(8) NOT NULL,
    "legal_name" TEXT NOT NULL,
    "normalized_legal_name" TEXT NOT NULL,
    "legal_nature" TEXT,
    "size" TEXT,
    "capital_cents" DECIMAL(24,0),
    "simples" BOOLEAN,
    "mei" BOOLEAN,

    CONSTRAINT "company_entities_pkey" PRIMARY KEY ("snapshot_id","base_cnpj")
);

-- CreateTable
CREATE TABLE "company_directory"."company_establishments" (
    "snapshot_id" TEXT NOT NULL,
    "cnpj" VARCHAR(14) NOT NULL,
    "base_cnpj" VARCHAR(8) NOT NULL,
    "trade_name" TEXT,
    "normalized_trade_name" TEXT,
    "main_cnae" TEXT,
    "city_code" TEXT,
    "uf" VARCHAR(2),
    "district" TEXT,
    "normalized_district" TEXT,
    "opening_date" DATE,
    "status" TEXT,
    "matrix_branch" TEXT,

    CONSTRAINT "company_establishments_pkey" PRIMARY KEY ("snapshot_id","cnpj")
);

-- CreateTable
CREATE TABLE "company_directory"."establishment_secondary_cnaes" (
    "snapshot_id" TEXT NOT NULL,
    "cnpj" VARCHAR(14) NOT NULL,
    "cnae" TEXT NOT NULL,

    CONSTRAINT "establishment_secondary_cnaes_pkey" PRIMARY KEY ("snapshot_id","cnpj","cnae")
);

-- CreateTable
CREATE TABLE "company_directory"."company_public_contacts" (
    "id" TEXT NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "cnpj" VARCHAR(14) NOT NULL,
    "channel" TEXT NOT NULL,
    "original_value" TEXT NOT NULL,
    "normalized_value" TEXT,
    "validation_state" TEXT NOT NULL DEFAULT 'unknown',

    CONSTRAINT "company_public_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_directory"."source_domains" (
    "snapshot_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "source_domains_pkey" PRIMARY KEY ("snapshot_id","kind","code")
);

-- CreateIndex
CREATE INDEX "company_snapshots_state_created_at_idx" ON "company_directory"."company_snapshots"("state", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "company_snapshots_competence_manifest_hash_key" ON "company_directory"."company_snapshots"("competence", "manifest_hash");

-- CreateIndex
CREATE UNIQUE INDEX "active_snapshot_snapshot_id_key" ON "company_directory"."active_snapshot"("snapshot_id");

-- CreateIndex
CREATE UNIQUE INDEX "company_source_files_snapshot_id_resource_id_key" ON "company_directory"."company_source_files"("snapshot_id", "resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "company_source_files_snapshot_id_resource_id_computed_hash_key" ON "company_directory"."company_source_files"("snapshot_id", "resource_id", "computed_hash");

-- CreateIndex
CREATE INDEX "company_entities_snapshot_id_normalized_legal_name_base_cnp_idx" ON "company_directory"."company_entities"("snapshot_id", "normalized_legal_name", "base_cnpj");

-- CreateIndex
CREATE INDEX "company_entities_snapshot_id_legal_nature_size_idx" ON "company_directory"."company_entities"("snapshot_id", "legal_nature", "size");

-- CreateIndex
CREATE INDEX "company_establishments_snapshot_id_status_uf_city_code_cnpj_idx" ON "company_directory"."company_establishments"("snapshot_id", "status", "uf", "city_code", "cnpj");

-- CreateIndex
CREATE INDEX "company_establishments_snapshot_id_main_cnae_cnpj_idx" ON "company_directory"."company_establishments"("snapshot_id", "main_cnae", "cnpj");

-- CreateIndex
CREATE INDEX "company_establishments_snapshot_id_normalized_trade_name_cn_idx" ON "company_directory"."company_establishments"("snapshot_id", "normalized_trade_name", "cnpj");

-- CreateIndex
CREATE INDEX "company_establishments_snapshot_id_normalized_district_cnpj_idx" ON "company_directory"."company_establishments"("snapshot_id", "normalized_district", "cnpj");

-- CreateIndex
CREATE INDEX "company_establishments_snapshot_id_base_cnpj_idx" ON "company_directory"."company_establishments"("snapshot_id", "base_cnpj");

-- CreateIndex
CREATE INDEX "establishment_secondary_cnaes_snapshot_id_cnae_cnpj_idx" ON "company_directory"."establishment_secondary_cnaes"("snapshot_id", "cnae", "cnpj");

-- CreateIndex
CREATE INDEX "company_public_contacts_snapshot_id_channel_normalized_valu_idx" ON "company_directory"."company_public_contacts"("snapshot_id", "channel", "normalized_value");

-- CreateIndex
CREATE UNIQUE INDEX "company_public_contacts_snapshot_id_cnpj_channel_original_v_key" ON "company_directory"."company_public_contacts"("snapshot_id", "cnpj", "channel", "original_value");

-- AddForeignKey
ALTER TABLE "company_directory"."active_snapshot" ADD CONSTRAINT "active_snapshot_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "company_directory"."company_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_directory"."company_source_files" ADD CONSTRAINT "company_source_files_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "company_directory"."company_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_directory"."company_import_checkpoints" ADD CONSTRAINT "company_import_checkpoints_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "company_directory"."company_source_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_directory"."company_entities" ADD CONSTRAINT "company_entities_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "company_directory"."company_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_directory"."company_establishments" ADD CONSTRAINT "company_establishments_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "company_directory"."company_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_directory"."company_establishments" ADD CONSTRAINT "company_establishments_snapshot_id_base_cnpj_fkey" FOREIGN KEY ("snapshot_id", "base_cnpj") REFERENCES "company_directory"."company_entities"("snapshot_id", "base_cnpj") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_directory"."establishment_secondary_cnaes" ADD CONSTRAINT "establishment_secondary_cnaes_snapshot_id_cnpj_fkey" FOREIGN KEY ("snapshot_id", "cnpj") REFERENCES "company_directory"."company_establishments"("snapshot_id", "cnpj") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_directory"."company_public_contacts" ADD CONSTRAINT "company_public_contacts_snapshot_id_cnpj_fkey" FOREIGN KEY ("snapshot_id", "cnpj") REFERENCES "company_directory"."company_establishments"("snapshot_id", "cnpj") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_directory"."source_domains" ADD CONSTRAINT "source_domains_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "company_directory"."company_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Directory-only DDL. This history is intentionally absent from deploy-migrations.
ALTER TABLE company_directory.company_snapshots
  ADD CONSTRAINT company_snapshot_competence CHECK (competence ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  ADD CONSTRAINT company_snapshot_state CHECK (state IN ('discovered','importing','validating','ready','published','failed'));
ALTER TABLE company_directory.active_snapshot ADD CONSTRAINT company_active_singleton CHECK (id = 'national' AND version > 0);
ALTER TABLE company_directory.company_entities
  ADD CONSTRAINT company_entity_base_cnpj CHECK (base_cnpj ~ '^[A-Z0-9]{8}$'),
  ADD CONSTRAINT company_entity_capital_nonnegative CHECK (capital_cents IS NULL OR capital_cents >= 0);
ALTER TABLE company_directory.company_establishments
  ADD CONSTRAINT company_establishment_cnpj CHECK (cnpj ~ '^[A-Z0-9]{12}[0-9]{2}$' AND substring(cnpj FROM 1 FOR 8) = base_cnpj),
  ADD CONSTRAINT company_establishment_matrix_branch CHECK (matrix_branch IS NULL OR matrix_branch IN ('matrix','branch'));
ALTER TABLE company_directory.company_import_checkpoints
  ADD CONSTRAINT company_checkpoint_offsets CHECK (batch_index >= 0 AND row_offset >= 0 AND byte_offset >= 0 AND committed_count >= 0);
ALTER TABLE company_directory.company_source_files
  ADD CONSTRAINT company_source_sizes CHECK ((compressed_bytes IS NULL OR compressed_bytes >= 0) AND (expanded_bytes IS NULL OR expanded_bytes >= 0) AND committed_count >= 0 AND rejected_count >= 0);
CREATE FUNCTION company_directory.validate_checkpoint_hash() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM company_directory.company_source_files WHERE id = NEW.file_id AND computed_hash = NEW.file_hash) THEN
    RAISE EXCEPTION 'checkpoint_file_hash_mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER checkpoint_hash_identity BEFORE INSERT OR UPDATE ON company_directory.company_import_checkpoints FOR EACH ROW EXECUTE FUNCTION company_directory.validate_checkpoint_hash();
