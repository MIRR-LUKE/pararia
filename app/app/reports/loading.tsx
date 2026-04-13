import { PageLoadingState } from "@/components/ui/PageLoadingState";

export default function ReportsLoading() {
  return (
    <PageLoadingState
      title="保護者レポートを読み込んでいます..."
      subtitle="未作成・レビュー待ち・共有待ち・処理中をまとめています。"
      rows={4}
    />
  );
}
