import { PageLoadingState } from "@/components/ui/PageLoadingState";

export default function SettingsLoading() {
  return (
    <PageLoadingState
      title="設定を開いています..."
      subtitle="組織情報と guardian 連絡先をまとめています。"
      rows={4}
    />
  );
}
