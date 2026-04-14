import { unstable_cache } from "next/cache";
import { listStudentRows } from "@/lib/students/list-student-rows";
import { mapStudentDirectoryRows } from "@/lib/students/student-directory-view";

type GetCachedStudentDirectoryViewOptions = {
  organizationId: string;
  limit: number;
  includeRecordingLock?: boolean;
};

export function getCachedStudentDirectoryView({
  organizationId,
  limit,
  includeRecordingLock = false,
}: GetCachedStudentDirectoryViewOptions) {
  return unstable_cache(
    async () =>
      mapStudentDirectoryRows(
        await listStudentRows({
          organizationId,
          limit,
          includeRecordingLock,
          projection: "directory",
        })
      ),
    ["student-directory-view", organizationId, String(limit), includeRecordingLock ? "with-lock" : "no-lock"],
    {
      revalidate: 10,
      tags: [`student-directory:${organizationId}`],
    }
  )();
}
