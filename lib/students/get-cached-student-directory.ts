import { unstable_cache } from "next/cache";
import { listStudentRows } from "@/lib/students/list-student-rows";
import type { StudentRowProjection } from "@/lib/students/student-row-query";

type GetCachedStudentDirectoryOptions = {
  organizationId: string;
  limit: number;
  includeRecordingLock?: boolean;
  projection?: StudentRowProjection;
};

export function getCachedStudentDirectory({
  organizationId,
  limit,
  includeRecordingLock = false,
  projection = "report",
}: GetCachedStudentDirectoryOptions) {
  return unstable_cache(
    () =>
      listStudentRows({
        organizationId,
        limit,
        includeRecordingLock,
        projection,
      }),
    ["student-directory", projection, organizationId, String(limit), includeRecordingLock ? "with-lock" : "no-lock"],
    {
      revalidate: 10,
      tags: [`student-directory:${organizationId}`],
    }
  )();
}
