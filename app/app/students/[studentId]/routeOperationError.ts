"use client";

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function formatRouteOperationError(body: unknown, fallbackMessage: string) {
  if (!body || typeof body !== "object") {
    return fallbackMessage;
  }

  const candidate = body as {
    error?: unknown;
    operationId?: unknown;
  };

  const message = asText(candidate.error) || fallbackMessage;
  const operationId = asText(candidate.operationId);
  if (!operationId) {
    return message;
  }

  return `${message} (参照ID: ${operationId})`;
}
