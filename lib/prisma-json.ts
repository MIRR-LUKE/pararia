import { Prisma } from "@prisma/client";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function cleanJsonValue(value: unknown): unknown {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();

  const valueType = typeof value;
  if (valueType === "string" || valueType === "boolean") return value;
  if (valueType === "number") return Number.isFinite(value) ? value : null;

  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined)
      .map((item) => cleanJsonValue(item));
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value).flatMap(([key, item]) => {
      if (item === undefined) return [];
      return [[key, cleanJsonValue(item)] as const];
    });
    return Object.fromEntries(entries);
  }

  if (valueType === "bigint") return String(value);

  return String(value ?? "");
}

export function toPrismaJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === null || value === undefined) return Prisma.DbNull;
  return cleanJsonValue(value) as Prisma.InputJsonValue;
}
