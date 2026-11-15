import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { PrismaClient } from "@prisma/client";

// Dedicated loopback test database. Never inherit a project DATABASE_URL or .env.
const url = "postgresql://meta_ads:meta-ads-local-test@127.0.0.1:15435/meta_ads";
export async function testDatabase() {
  const schema = `mga_${process.pid}_${randomUUID().replaceAll("-", "")}`;
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  await sql.query(`CREATE SCHEMA "${schema}"`);
  await sql.query(`SET search_path TO "${schema}"`);
  const prisma = new PrismaClient({ datasources: { db: { url: `${url}?schema=${schema}` } } });
  const close = async () => {
    await prisma.$disconnect();
    await sql.query(`DROP SCHEMA "${schema}" CASCADE`);
    await sql.end();
  };
  try {
    await sql.query("CREATE TABLE merchants(id TEXT PRIMARY KEY)");
    await sql.query(await readFile(new URL("../../../../../prisma/migrations/20261114180000_meta_ads_agent/migration.sql", import.meta.url), "utf8"));
    await sql.query("INSERT INTO merchants(id) VALUES ('store-a'),('store-b')");
    return { sql, prisma, close };
  } catch (error) { await close(); throw error; }
}
