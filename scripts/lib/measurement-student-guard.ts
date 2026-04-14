type MeasurementStudentRecord = {
  id: string;
  name?: string | null;
  grade?: string | null;
  course?: string | null;
};

type MeasurementStudentRule = {
  namePrefix: string;
  allowedGrades: string[];
  coursePrefixes: string[];
};

function valueMatchesPrefix(value: string | null | undefined, prefixes: string[]) {
  if (!value) return false;
  return prefixes.some((prefix) => value.startsWith(prefix));
}

export function isMeasurementStudent(record: MeasurementStudentRecord, rule: MeasurementStudentRule) {
  return (
    record.name?.startsWith(rule.namePrefix) === true &&
    rule.allowedGrades.includes(record.grade ?? "") &&
    valueMatchesPrefix(record.course, rule.coursePrefixes)
  );
}

export function assertMeasurementStudent(record: MeasurementStudentRecord | null | undefined, rule: MeasurementStudentRule) {
  if (!record) {
    throw new Error("検証用生徒の確認に失敗しました: student not found");
  }
  if (!isMeasurementStudent(record, rule)) {
    throw new Error(
      `検証用 cleanup を中断しました: 想定外の student です (${record.id} / ${record.name ?? "unknown"} / ${record.grade ?? "no-grade"} / ${record.course ?? "no-course"})`
    );
  }
}
