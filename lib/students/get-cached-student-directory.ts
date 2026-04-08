import { unstable_cache } from "next/cache";
import { listStudentRows } from "@/lib/students/list-student-rows";

type GetCachedStudentDirectoryOptions = {
  organizationId: string;
  limit: number;
};

export function getCachedStudentDirectory({
  organizationId,
  limit,
}: GetCachedStudentDirectoryOptions) {
  return unstable_cache(
    () =>
      listStudentRows({
        organizationId,
        limit,
    }),
    ["student-directory", organizationId, String(limit)],
    {
      revalidate: 10,
      tags: [`student-directory:${organizationId}`],
    }
  )();
}
