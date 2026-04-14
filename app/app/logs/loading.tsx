import { PageLoadingState } from "@/components/ui/PageLoadingState";

export default function LogsLoading() {
  return (
    <PageLoadingState
      title="ログ一覧を開いています..."
      subtitle="面談ログと指導報告ログを整理しています。"
      rows={4}
    />
  );
}
