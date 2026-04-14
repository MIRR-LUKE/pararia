import { PageLoadingState } from "@/components/ui/PageLoadingState";

export default function StudentsLoading() {
  return (
    <PageLoadingState
      title="生徒一覧を開いています..."
      subtitle="必要な分だけ先に出しています。"
      rows={3}
    />
  );
}
