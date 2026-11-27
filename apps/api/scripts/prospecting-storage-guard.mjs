const GiB = 1024 ** 3;
const capacityError = () => new Error("production_storage_measurement_unavailable");

// This fixed, read-only command runs on the PostgreSQL server with its existing
// privileges. Both paths follow symlinks, including a separately mounted WAL.
const measureVolumes = `COPY pg_temp.prospecting_import_volume FROM PROGRAM 'LC_ALL=C df -Pk "$PGDATA" "$PGDATA/pg_wal"'`;

export async function guardProspectingImportBatch(client, writeBatch) {
  let volumes, databaseBytes;
  try {
    await client.query("CREATE TEMP TABLE IF NOT EXISTS prospecting_import_volume (line text)");
    await client.query("TRUNCATE pg_temp.prospecting_import_volume");
    await client.query(measureVolumes);
    const lines = (await client.query("SELECT line FROM pg_temp.prospecting_import_volume")).rows.map(r => r.line);
    if (lines.length !== 3 || !lines[0].startsWith("Filesystem")) throw capacityError();
    volumes = lines.slice(1).map(line => {
      const fields = /^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+%\s+(.+)$/.exec(line);
      if (!fields) throw capacityError();
      const totalBytes = BigInt(fields[2]) * 1024n, availableBytes = BigInt(fields[4]) * 1024n;
      // Refuse an overlay/host filesystem that does not expose this service's
      // known 50,000 MB volume quota. An unreadable quota must never fail open.
      if (totalBytes < BigInt(GiB) || totalBytes > 50_000_000_000n || availableBytes > totalBytes)
        throw capacityError();
      return { mount: fields[5], totalBytes: totalBytes.toString(), availableBytes: availableBytes.toString() };
    });
    databaseBytes = (await client.query("SELECT pg_database_size(current_database())::text AS bytes")).rows[0].bytes;
    if (!/^\d+$/.test(databaseBytes)) throw capacityError();
  } catch {
    throw capacityError();
  }
  // Preserve 15 GiB for commerce/WAL plus a 256 MiB in-flight batch allowance.
  if (volumes.some(v => BigInt(v.availableBytes) < BigInt(15 * GiB + 256 * 1024 ** 2)) || BigInt(databaseBytes) >= BigInt(35 * GiB))
    throw new Error("production_directory_storage_limit");
  const result = await writeBatch();
  return { result, storage: { databaseBytes, volumes, measuredAt: new Date().toISOString() } };
}
