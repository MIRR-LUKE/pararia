import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

export type OperationContext = {
  route: string;
  operationId: string;
};

type OperationErrorOptions = {
  stage: string;
  message: string;
  status?: number;
  error?: unknown;
  extra?: Record<string, unknown>;
};

type OperationLogOptions = {
  stage: string;
  message?: string;
  error?: unknown;
  extra?: Record<string, unknown>;
};

export function createOperationContext(route: string): OperationContext {
  return {
    route,
    operationId: randomUUID(),
  };
}

export function withOperationMeta<T extends Record<string, unknown>>(
  context: OperationContext,
  stage: string,
  body: T
) {
  return {
    ...body,
    operationId: context.operationId,
    stage,
  };
}

export function logOperationError(context: OperationContext, options: OperationLogOptions) {
  const error = options.error as { message?: string; stack?: string } | undefined;
  console.error(`[${context.route}]`, {
    operationId: context.operationId,
    stage: options.stage,
    message: options.message ?? error?.message ?? "Unexpected error",
    error: error?.message ?? null,
    stack: error?.stack ?? null,
    ...(options.extra ?? {}),
  });
}

export function operationErrorResponse(context: OperationContext, options: OperationErrorOptions) {
  logOperationError(context, options);
  return NextResponse.json(
    withOperationMeta(context, options.stage, {
      error: options.message,
      ...(options.extra ?? {}),
    }),
    { status: options.status ?? 500 }
  );
}
