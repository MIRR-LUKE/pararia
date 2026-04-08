import { PageLoadingState } from "@/components/ui/PageLoadingState";

export default function StudentsLoading() {
  return (
    <PageLoadingState
      title="生徒一覧を開いています..."
      subtitle="必要な生徒だけを先に並べています。"
      rows={4}
    />
  );
}
