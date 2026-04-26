import Link from "next/link";
import styles from "./teacher.module.css";

export default function TeacherPage() {
  return (
    <main className={styles.page}>
      <section className={`${styles.authCard} ${styles.nativeOnlyCard}`}>
        <div className={styles.eyebrow}>PARARIA Teacher App</div>
        <h1 className={styles.title}>録音はネイティブアプリ専用です</h1>
        <p className={styles.description}>
          Web からの録音開始と音声アップロード導線は終了しました。面談録音は Android Teacher App から行ってください。
        </p>
        <div className={styles.noticeList} aria-label="Webでできること">
          <div>
            <strong>録音</strong>
            <span>Android Teacher App で開始・終了します。</span>
          </div>
          <div>
            <strong>ログ確認</strong>
            <span>生成後の面談ログと保護者レポートは Web 管理画面で確認できます。</span>
          </div>
          <div>
            <strong>端末管理</strong>
            <span>端末の失効や状態確認は管理コンソールで扱います。</span>
          </div>
        </div>
        <Link className={styles.textLink} href="/app">
          Web 管理画面へ戻る
        </Link>
      </section>
    </main>
  );
}
