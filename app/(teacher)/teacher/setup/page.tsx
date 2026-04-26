import Link from "next/link";
import styles from "../teacher.module.css";

export default function TeacherSetupPage() {
  return (
    <main className={styles.page}>
      <section className={`${styles.authCard} ${styles.nativeOnlyCard}`}>
        <div className={styles.eyebrow}>PARARIA Teacher App</div>
        <h1 className={styles.title}>端末設定はアプリで行います</h1>
        <p className={styles.description}>
          Web 版の校舎端末設定は終了しました。Android Teacher App を開き、管理者または室長のアカウントで端末を登録してください。
        </p>
        <Link className={styles.textLink} href="/app">
          Web 管理画面へ戻る
        </Link>
      </section>
    </main>
  );
}
