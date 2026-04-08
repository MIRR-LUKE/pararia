import { PageLoadingState } from "@/components/ui/PageLoadingState";

export default function DashboardLoading() {
  return (
    <PageLoadingState
      title="ダッシュボードを開いています..."
      subtitle="今日の優先キューをまとめています。"
      rows={4}
    />
  );
}
