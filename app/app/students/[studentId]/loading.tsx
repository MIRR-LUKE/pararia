import { PageLoadingState } from "@/components/ui/PageLoadingState";

export default function StudentDetailLoading() {
  return (
    <PageLoadingState
      title="生徒詳細を開いています..."
      subtitle="録音カードと次の確認事項を先に準備しています。"
      rows={3}
    />
  );
}
