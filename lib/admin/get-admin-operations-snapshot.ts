import type { SettingsSnapshot } from "@/lib/settings/get-settings-snapshot";
import { getSettingsSnapshot } from "@/lib/settings/get-settings-snapshot";

export type AdminOperationsSnapshot = Pick<SettingsSnapshot, "organization" | "permissions" | "operations">;

type GetAdminOperationsSnapshotOptions = {
  organizationId: string;
  viewerRole?: string;
  viewerEmail?: string | null;
};

export async function getAdminOperationsSnapshot({
  organizationId,
  viewerRole,
  viewerEmail,
}: GetAdminOperationsSnapshotOptions): Promise<AdminOperationsSnapshot | null> {
  const snapshot = await getSettingsSnapshot({ organizationId, viewerRole, viewerEmail });
  if (!snapshot) return null;

  return {
    organization: snapshot.organization,
    permissions: snapshot.permissions,
    operations: snapshot.operations,
  };
}
