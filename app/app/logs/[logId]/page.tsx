import { LogDetailView } from "../LogDetailView";

export default function LogDetailPage({ params }: { params: { logId: string } }) {
  return <LogDetailView logId={params.logId} />;
}
