import { PageLoadingState } from "@/components/ui/PageLoadingState";

export default function ReportsLoading() {
  return (
    <PageLoadingState
      title="保護者レポートを開いています..."
      subtitle="レビュー待ちと共有待ちをまとめています。"
      rows={4}
    />
  );
}
