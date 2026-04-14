type NormalizedStudentInput = {
  name?: string;
  nameKana?: string | null;
  grade?: string | null;
  course?: string | null;
  guardianNames?: string | null;
  enrollmentDate?: Date | null;
  birthdate?: Date | null;
};

function normalizeTextField(
  value: unknown,
  fieldName: string,
  options: { required?: boolean } = {}
) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    if (options.required) {
      throw new TypeError(`${fieldName} is required`);
    }
    return null;
  }
  if (typeof value !== "string") {
    throw new TypeError(`${fieldName} must be a string${options.required ? "" : " or null"}`);
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    if (options.required) {
      throw new TypeError(`${fieldName} is required`);
    }
    return null;
  }

  return trimmed;
}

function normalizeDateField(value: unknown, fieldName: string) {
  if (value === undefined) return undefined;
  if (value === null) return null;

  const dateValue = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  if (!dateValue || Number.isNaN(dateValue.getTime())) {
    throw new TypeError(`${fieldName} must be a valid date string or null`);
  }
  return dateValue;
}

export function normalizeGuardianNames(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(value)) {
    const joined = value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .join(" / ");
    return joined.length > 0 ? joined : null;
  }
  throw new TypeError("guardianNames must be a string, string[], or null");
}

export function normalizeStudentCreateInput(body: unknown): NormalizedStudentInput & { name: string } {
  const source = typeof body === "object" && body ? (body as Record<string, unknown>) : {};

  return {
    name: normalizeTextField(source.name, "name", { required: true }) as string,
    nameKana: normalizeTextField(source.nameKana, "nameKana") ?? null,
    grade: normalizeTextField(source.grade, "grade") ?? null,
    course: normalizeTextField(source.course, "course") ?? null,
    guardianNames: normalizeGuardianNames(source.guardianNames) ?? null,
    enrollmentDate: normalizeDateField(source.enrollmentDate, "enrollmentDate") ?? null,
    birthdate: normalizeDateField(source.birthdate, "birthdate") ?? null,
  };
}

export function normalizeStudentUpdateInput(body: unknown): NormalizedStudentInput {
  const source = typeof body === "object" && body ? (body as Record<string, unknown>) : {};
  const data: NormalizedStudentInput = {};

  if ("name" in source) {
    data.name = normalizeTextField(source.name, "name", { required: true }) ?? undefined;
  }
  if ("nameKana" in source) {
    data.nameKana = normalizeTextField(source.nameKana, "nameKana") ?? null;
  }
  if ("grade" in source) {
    data.grade = normalizeTextField(source.grade, "grade") ?? null;
  }
  if ("course" in source) {
    data.course = normalizeTextField(source.course, "course") ?? null;
  }
  if ("guardianNames" in source) {
    data.guardianNames = normalizeGuardianNames(source.guardianNames) ?? null;
  }
  if ("enrollmentDate" in source) {
    data.enrollmentDate = normalizeDateField(source.enrollmentDate, "enrollmentDate") ?? null;
  }
  if ("birthdate" in source) {
    data.birthdate = normalizeDateField(source.birthdate, "birthdate") ?? null;
  }

  return data;
}
