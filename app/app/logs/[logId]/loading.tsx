import { PageLoadingState } from "@/components/ui/PageLoadingState";

export default function Loading() {
  return (
    <PageLoadingState
      title="文字起こしレビューを読み込んでいます"
      subtitle="固有名詞候補とレビュー理由を整理しています。"
      rows={4}
    />
  );
}
