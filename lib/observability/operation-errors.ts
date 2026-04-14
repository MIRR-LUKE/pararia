import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

export type OperationErrorContext = {
  operation: string;
  operationId: string;
};

export type OperationErrorStage = string;
export type OperationErrorLevel = "warn" | "error";
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

export function createOperationErrorContext(operation: string): OperationErrorContext {
  return {
    operation,
    operationId: randomUUID(),
  };
}

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return error;
}

export function logOperationIssue(input: {
  context: OperationErrorContext;
  stage: OperationErrorStage;
  message: string;
  error?: unknown;
  level?: OperationErrorLevel;
  extra?: Record<string, unknown>;
}) {
  const level = input.level ?? "error";
  const logger = level === "warn" ? console.warn : console.error;
  logger(`[${input.context.operation}]`, {
    operationId: input.context.operationId,
    stage: input.stage,
    message: input.message,
    error: normalizeError(input.error),
    ...(input.extra ?? {}),
  });
}

export function respondWithOperationError(input: {
  context: OperationErrorContext;
  stage: OperationErrorStage;
  message: string;
  status: number;
  error?: unknown;
  level?: OperationErrorLevel;
  extra?: Record<string, unknown>;
}) {
  logOperationIssue({
    context: input.context,
    stage: input.stage,
    message: input.message,
    error: input.error,
    level: input.level ?? (input.status >= 500 ? "error" : "warn"),
    extra: input.extra,
  });

  return NextResponse.json(
    {
      error: input.message,
      operationId: input.context.operationId,
      stage: input.stage,
    },
    { status: input.status }
  );
}

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
  logOperationIssue({
    context: {
      operation: context.route,
      operationId: context.operationId,
    },
    stage: options.stage,
    message: options.message ?? (options.error instanceof Error ? options.error.message : "Unexpected error"),
    error: options.error,
    extra: options.extra,
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
