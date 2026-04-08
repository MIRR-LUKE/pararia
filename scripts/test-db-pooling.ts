import assert from "node:assert/strict";
import { normalizePrismaDatabaseUrl, shouldConstrainPrismaPool } from "../lib/db-url";

const pooled = "postgresql://user:pass@aws-1-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require";
const normalized = new URL(normalizePrismaDatabaseUrl(pooled)!);

assert.equal(shouldConstrainPrismaPool(pooled), true);
assert.equal(normalized.hostname, "aws-1-ap-south-1.pooler.supabase.com");
assert.equal(normalized.searchParams.get("sslmode"), "require");
assert.equal(normalized.searchParams.get("connection_limit"), "1");
assert.equal(normalized.searchParams.get("pool_timeout"), "20");

const alreadyPinned =
  "postgresql://user:pass@aws-1-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require&connection_limit=3";
const preserved = new URL(normalizePrismaDatabaseUrl(alreadyPinned)!);
assert.equal(preserved.searchParams.get("connection_limit"), "3");

const local = "postgresql://user:pass@localhost:5432/pararia";
assert.equal(shouldConstrainPrismaPool(local), false);
assert.equal(normalizePrismaDatabaseUrl(local), local);

console.log("db-pooling checks passed");
