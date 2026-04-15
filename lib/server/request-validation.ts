import { z } from "zod";
import { fromError } from "zod-validation-error";

export class RequestValidationError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "RequestValidationError";
    this.status = status;
  }
}

function toValidationMessage(error: unknown, label?: string) {
  return fromError(error, {
    prefix: label ? `${label} が不正です` : "入力が不正です",
    prefixSeparator: ": ",
    includePath: true,
  }).message;
}

export function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown, label?: string) {
  try {
    return schema.parse(value);
  } catch (error) {
    throw new RequestValidationError(toValidationMessage(error, label));
  }
}

export async function parseJsonWithSchema<T>(request: Request, schema: z.ZodType<T>, label?: string) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new RequestValidationError(label ? `${label} の JSON を読めませんでした。` : "JSON を読めませんでした。");
  }
  return parseWithSchema(schema, body, label);
}
