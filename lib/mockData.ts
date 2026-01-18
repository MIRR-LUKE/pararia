export type ProfileField = {
  value: string;
  detail?: string;
  updatedAt?: string;
  sourceLogId?: string;
  confidence?: number;
  category?: string;
};

export type ProfileSections = {
  personal?: Record<string, ProfileField>;
  basics?: Record<string, ProfileField>;
};

export type StudentProfileData = {
  summary: string;
  personal: Record<string, ProfileField>;
  basics: Record<string, ProfileField>;
  aiTodos: Array<{
    action: string;
    reason: string;
    relatedLogId?: string;
  }>;
};

export type StudentData = {
  id: string;
  name: string;
  nameKana?: string;
  grade: string;
  course: string;
  enrollmentDate?: string;
  birthdate?: string;
  guardianNames?: string;
  lastConversationDate?: string;
  conversationCount?: number;
  motivationScore: number;
  teacher: string;
  profile: StudentProfileData;
  motivationHistory: { month: string; score: number }[];
  events: { date: string; label: string; type: "exam" | "club" | "family" | "school" }[];
  studyPlan: { date: string; title: string; status: "planned" | "done" | "pending"; category: string }[];
};

export type ConversationLogData = {
  id: string;
  studentId: string;
  user: string;
  date: string;
  summary: string;
  keyQuotes: string[];
  keyTopics: string[];
  nextActions: string[];
  structuredDelta: ProfileSections;
  sentimentScore?: number;
  motivationScore?: number;
  risk?: "LOW" | "MEDIUM" | "HIGH";
  sourceType?: "AUDIO" | "MANUAL";
  updatedAt?: string;
  notes?: string;
};

export const students: StudentData[] = [
  {
    id: "s-1",
    name: "宮本 徹生",
    nameKana: "ミヤモト テツオ",
    grade: "高校1年",
    course: "進学コース",
    enrollmentDate: "2024-04-01",
    birthdate: "2009-06-18",
    guardianNames: "父: 宮本 健司 / 母: 宮本 明日香",
    lastConversationDate: "2025-11-25",
    conversationCount: 4,
    motivationScore: 64,
    teacher: "浅見",
    profile: {
      summary:
        "出題意図を読む練習と解法再現度の向上を強化中。雑談から好みや生活リズムを把握し、声かけや課題設計に活用。",
      personal: {
        favoriteFood: {
          value: "味噌ラーメン / 抹茶アイス",
          updatedAt: "2025-11-25",
          sourceLogId: "log-100",
        },
        currentHobby: {
          value: "ローファイ音楽と歴史小説、最近はバスケ観戦",
          updatedAt: "2025-11-25",
          sourceLogId: "log-100",
        },
        personality: {
          value: "真面目・素直・粘り強い。作業化するとモチベ低下",
          updatedAt: "2025-11-25",
          sourceLogId: "log-100",
        },
        motivationSource: {
          value: "計画達成と成果実感。出題意図を掴めた時に伸びる",
          updatedAt: "2025-11-25",
          sourceLogId: "log-100",
        },
        ngApproach: {
          value: "量だけを強いる・作業化する宿題の丸投げ",
          updatedAt: "2025-11-25",
          sourceLogId: "log-100",
        },
        lifestyle: {
          value: "夜型気味。家族旅行前に宿題を前倒しで進める傾向",
          updatedAt: "2025-08-12",
          sourceLogId: "log-103",
        },
      },
      basics: {
        guardians: {
          value: "父: 宮本 健司 / 母: 宮本 明日香",
          updatedAt: "2025-04-01",
        },
        address: {
          value: "東京都杉並区西荻北 1-2-3",
          updatedAt: "2025-04-01",
        },
        school: {
          value: "都立西荻高校",
          updatedAt: "2025-04-01",
        },
        targetSchool: {
          value: "早稲田大学 社会科学部（第1志望）",
          updatedAt: "2025-09-01",
        },
        requiredSubjects: {
          value: "数学 / 英語 / 日本史",
          updatedAt: "2025-09-01",
        },
      },
      aiTodos: [
        {
          action: "数学：過去問の出題意図を3問言語化し、類題をChatGPTで生成",
          reason: "前回テストで平均点前後に留まった原因は、出題形式が変わると得点できない点。最新の会話ログ（2025-11-25）で、出題意図を読む練習と迎撃練習の重要性が確認されています。",
          relatedLogId: "log-100",
        },
        {
          action: "歴史：5W1Hで10トピックを深掘りし、並び替え問題を想定",
          reason: "テスト振り返り（2025-10-26）で、聞かれ方が違うと得点できない課題が明確。5W1Hの深掘り練習により、出題パターンへの対応力を向上させます。",
          relatedLogId: "log-101",
        },
        {
          action: "英語：長文の音読＋速読を20分、記録を残す",
          reason: "前回テストで時間不足が課題。学習が作業化しているため、音読と速読の記録を残すことで、具体的な成果実感につながり、モチベーション向上が期待できます。",
          relatedLogId: "log-100",
        },
      ],
    },
    motivationHistory: [
      { month: "9月", score: 70 },
      { month: "10月", score: 66 },
      { month: "11月", score: 64 },
    ],
    events: [
      { date: "2025-09-26", label: "定期テスト準備開始", type: "exam" },
      { date: "2025-10-26", label: "定期テスト返却", type: "exam" },
      { date: "2025-11-25", label: "会話（出題意図対策）", type: "school" },
    ],
    studyPlan: [
      {
        date: "2025-11-27",
        title: "数学 過去問レビュー（解法再現度チェック）",
        status: "planned",
        category: "math",
      },
      {
        date: "2025-11-28",
        title: "歴史 5W1H類題づくり",
        status: "planned",
        category: "history",
      },
      {
        date: "2025-11-29",
        title: "英語 音読＋速読20分",
        status: "pending",
        category: "english",
      },
      {
        date: "2025-12-01",
        title: "ChatGPTで歴史類題作成",
        status: "planned",
        category: "tool",
      },
    ],
  },
  {
    id: "s-2",
    name: "田中 ほのか",
    nameKana: "タナカ ホノカ",
    grade: "高校1年",
    course: "英語集中コース",
    enrollmentDate: "2024-04-01",
    birthdate: "2009-10-05",
    guardianNames: "父: 田中 和也 / 母: 田中 美咲",
    lastConversationDate: "2025-11-20",
    conversationCount: 2,
    motivationScore: 78,
    teacher: "鈴木",
    profile: {
      summary: "英語発音とスピーキングが得意。雑談からカフェ巡り・海外ドラマの好みを把握し、教材選定や声かけに活用。",
      personal: {
        favoriteFood: { value: "抹茶スイーツとカフェ巡り", updatedAt: "2025-11-20", sourceLogId: "log-104" },
        currentHobby: { value: "英語ポッドキャスト / 海外ドラマ", updatedAt: "2025-11-20", sourceLogId: "log-104" },
        personality: { value: "ポジティブ・社交型。発音褒めで伸びる", updatedAt: "2025-11-20", sourceLogId: "log-104" },
        motivationSource: { value: "仲間との競争とフィードバック", updatedAt: "2025-11-20", sourceLogId: "log-104" },
        ngApproach: { value: "細かい指摘の連発はNG", updatedAt: "2025-11-20", sourceLogId: "log-104" },
        lifestyle: { value: "週末ディベートの準備で友人と練習", updatedAt: "2025-11-20", sourceLogId: "log-104" },
      },
      basics: {
        guardians: { value: "父: 田中 和也 / 母: 田中 美咲", updatedAt: "2024-04-01" },
        address: { value: "東京都世田谷区深沢 4-5-6", updatedAt: "2024-04-01" },
        school: { value: "私立青葉女学院高等学校", updatedAt: "2024-04-01" },
        targetSchool: { value: "上位私立文系（検討中）", updatedAt: "2025-10-01" },
        requiredSubjects: { value: "英語 / 国語 / 日本史", updatedAt: "2025-10-01" },
      },
      aiTodos: [
        {
          action: "スピーキング録音を週3回、フィードバックを反映",
          reason: "英語の発音・表現に自信がつき、クラスを引っ張る存在として成功体験を積み重ねています。スピーキング録音により、継続的なフィードバックで更なる向上が期待できます。",
          relatedLogId: "log-104",
        },
        {
          action: "単語30語を例文付きで暗唱、週末に口頭チェック",
          reason: "音読＋アウトプット重視の学習スタイルに合致。例文付きで暗唱することで、実践的な語彙力向上が図れます。",
          relatedLogId: "log-104",
        },
        {
          action: "模試リスニングの聞き直しとスクリプト精読を1セット",
          reason: "仲間との競争・フィードバックがモチベーションの源泉。模試のリスニングを徹底的に分析することで、具体的な成果実感につながります。",
          relatedLogId: "log-104",
        },
      ],
    },
    motivationHistory: [
      { month: "9月", score: 74 },
      { month: "10月", score: 76 },
      { month: "11月", score: 78 },
    ],
    events: [
      { date: "2025-10-28", label: "スピーチコンテスト", type: "school" },
      { date: "2025-11-18", label: "模試", type: "exam" },
    ],
    studyPlan: [
      { date: "2025-11-20", title: "単語30語 音読+例文", status: "done", category: "english" },
      { date: "2025-11-21", title: "リスニングシャドーイング20分", status: "planned", category: "english" },
      { date: "2025-11-22", title: "友人とミニディベート", status: "planned", category: "output" },
    ],
  },
  {
    id: "s-3",
    name: "森下 智也",
    nameKana: "モリシタ トモヤ",
    grade: "中学2年",
    course: "定期テスト対策",
    enrollmentDate: "2023-09-01",
    birthdate: "2011-02-14",
    guardianNames: "父: 森下 大輔 / 母: 森下 佳奈",
    lastConversationDate: "2025-11-22",
    conversationCount: 2,
    motivationScore: 50,
    teacher: "山本",
    profile: {
      summary: "生活リズムの乱れに配慮し、小さな成功体験を積む方針。雑談からボードゲーム・アニメの好みを把握。",
      personal: {
        favoriteFood: { value: "カレーとプリン", updatedAt: "2025-11-22", sourceLogId: "log-105" },
        currentHobby: { value: "アニメとボードゲーム", updatedAt: "2025-11-22", sourceLogId: "log-105" },
        personality: { value: "マイペース・内向型。安心感が重要", updatedAt: "2025-11-22", sourceLogId: "log-105" },
        motivationSource: { value: "承認と明確な次の一手", updatedAt: "2025-11-22", sourceLogId: "log-105" },
        ngApproach: { value: "大人数での指摘、曖昧な指示はNG", updatedAt: "2025-11-22", sourceLogId: "log-105" },
        lifestyle: { value: "家庭事情で夜型になりがち。10分ドリルを習慣化中", updatedAt: "2025-11-22", sourceLogId: "log-105" },
      },
      basics: {
        guardians: { value: "父: 森下 大輔 / 母: 森下 佳奈", updatedAt: "2023-09-01" },
        address: { value: "東京都練馬区豊玉南 7-8-9", updatedAt: "2023-09-01" },
        school: { value: "練馬区立第七中学校", updatedAt: "2023-09-01" },
        targetSchool: { value: "都立 上位校（検討中）", updatedAt: "2025-10-01" },
        requiredSubjects: { value: "数学 / 英語 / 理科", updatedAt: "2025-10-01" },
      },
      aiTodos: [
        {
          action: "毎日10分の計算ドリル＋できたこと3つの記録",
          reason: "マイペース・内向型の性格に合わせ、小さな成功体験を積み重ねることが重要。できたことを記録することで、承認と明確な次の一手が得られ、モチベーション向上が期待できます。",
          relatedLogId: "log-105",
        },
        {
          action: "理科：映像授業を視聴し、質問を1つメモして次回解決",
          reason: "映像授業＋個別質問の学習スタイルに最適。質問をメモすることで、次回の面談で効率的に解決でき、学習の継続性が保たれます。",
          relatedLogId: "log-105",
        },
        {
          action: "英語：単語10個を朝に暗記、夜に口頭チェック",
          reason: "細かい指摘の連発はNGアプローチ。小さな目標を設定し、達成感を得ることで、自信を育むことができます。",
          relatedLogId: "log-105",
        },
      ],
    },
    motivationHistory: [
      { month: "9月", score: 55 },
      { month: "10月", score: 52 },
      { month: "11月", score: 50 },
    ],
    events: [
      { date: "2025-10-05", label: "体育祭", type: "school" },
      { date: "2025-11-10", label: "期末テスト", type: "exam" },
      { date: "2025-11-22", label: "家庭の事情で休み", type: "family" },
    ],
    studyPlan: [
      { date: "2025-11-22", title: "計算ドリル10分", status: "done", category: "math" },
      { date: "2025-11-23", title: "英単語10分", status: "pending", category: "english" },
      { date: "2025-11-24", title: "映像授業(理科) 20分", status: "planned", category: "science" },
    ],
  },
  {
    id: "s-4",
    name: "張 明里",
    nameKana: "チョウ アカリ",
    grade: "高校2年",
    course: "理系選抜",
    enrollmentDate: "2024-04-01",
    birthdate: "2008-03-21",
    guardianNames: "父: 張 健 / 母: 張 芳美",
    lastConversationDate: "2025-11-15",
    conversationCount: 2,
    motivationScore: 69,
    teacher: "佐藤",
    profile: {
      summary: "理系科目は安定。雑談から理系研究ニュースとサイエンスカフェ好きが判明し、教材提案に活用。",
      personal: {
        favoriteFood: { value: "麻婆豆腐とタピオカ", updatedAt: "2025-11-15", sourceLogId: "log-106" },
        currentHobby: { value: "サイエンスカフェ・数学パズル・カメラ", updatedAt: "2025-11-15", sourceLogId: "log-106" },
        personality: { value: "挑戦型・分析好き。褒めと難問突破が燃料", updatedAt: "2025-11-15", sourceLogId: "log-106" },
        motivationSource: { value: "難問突破と称賛。研究ニュースの共有で上がる", updatedAt: "2025-11-15", sourceLogId: "log-106" },
        ngApproach: { value: "単調な反復のみはNG。理由とゴールを共有する", updatedAt: "2025-11-15", sourceLogId: "log-106" },
        lifestyle: { value: "時間管理が課題。タイムトライアルで改善中", updatedAt: "2025-11-15", sourceLogId: "log-106" },
      },
      basics: {
        guardians: { value: "父: 張 健 / 母: 張 芳美", updatedAt: "2024-04-01" },
        address: { value: "神奈川県川崎市中原区小杉町 2-3-4", updatedAt: "2024-04-01" },
        school: { value: "県立川崎理数高校", updatedAt: "2024-04-01" },
        targetSchool: { value: "東京工業大学を検討", updatedAt: "2025-10-01" },
        requiredSubjects: { value: "数学 / 物理 / 化学 / 英語", updatedAt: "2025-10-01" },
      },
      aiTodos: [
        {
          action: "物理：週2回のタイムトライアル結果をグラフ化",
          reason: "物理計算に時間がかかり、模試で時間切れが続いている課題。タイムトライアルで計算スピードを上げ、結果をグラフ化することで成長を可視化し、難問突破と称賛というモチベーション源に繋がります。",
          relatedLogId: "log-105",
        },
        {
          action: "進路：研究室見学の質問を5個準備し、面談で壁打ち",
          reason: "志望校の相談が増えており、進路面談の深堀りが必要。挑戦型・分析好きの性格を活かし、質問を準備することで、より深い進路相談が可能になります。",
          relatedLogId: "log-105",
        },
        {
          action: "数学：難問1題を分解し、解法ステップをスライド化",
          reason: "深堀り＋プレゼンの学習スタイルに最適。難問を分解してスライド化することで、理解が深まり、プレゼン能力も向上します。",
          relatedLogId: "log-105",
        },
      ],
    },
    motivationHistory: [
      { month: "9月", score: 65 },
      { month: "10月", score: 67 },
      { month: "11月", score: 69 },
    ],
    events: [
      { date: "2025-10-15", label: "理科研究発表", type: "school" },
      { date: "2025-11-25", label: "模試", type: "exam" },
    ],
    studyPlan: [
      { date: "2025-11-16", title: "物理タイムトライアル20分", status: "done", category: "physics" },
      { date: "2025-11-17", title: "数学難問1題", status: "planned", category: "math" },
      { date: "2025-11-20", title: "大学研究室の質問整理", status: "planned", category: "career" },
    ],
  },
];

export const conversationLogs: ConversationLogData[] = [
  {
    id: "log-100",
    studentId: "s-1",
    user: "浅見",
    date: "2025-11-25",
    updatedAt: "2025-11-26 12:45",
    summary:
      "平均点止まりの原因を整理。出題意図を読む練習と解法再現度をゴールに設定し、類題生成を導入。雑談で好きな食べ物と趣味を把握。",
    keyQuotes: [
      "「ワークは覚えたのに聞かれ方が違うとボコボコにされた」",
      "「教科書を音読している。流れはわかる」",
      "「どう出題されるかを考える練習が足りない」",
    ],
    keyTopics: ["テスト対策", "出題意図", "音読", "趣味・食べ物"],
    nextActions: [
      "数学：過去問から3問、出題意図を言語化し類題を作成",
      "歴史：5W1Hで10トピックを深掘り、並び替え問題を想定",
      "英語：音読＋速読を20分、処理速度ログを記録",
    ],
    structuredDelta: {
      personal: {
        favoriteFood: { value: "味噌ラーメン / 抹茶アイス", sourceLogId: "log-100", updatedAt: "2025-11-25" },
        currentHobby: { value: "歴史小説とローファイ音楽", sourceLogId: "log-100", updatedAt: "2025-11-25" },
        personality: { value: "真面目・粘り強いが作業化すると落ちる", sourceLogId: "log-100", updatedAt: "2025-11-25" },
        motivationSource: { value: "計画達成と成果実感", sourceLogId: "log-100", updatedAt: "2025-11-25" },
        ngApproach: { value: "量だけを強いる宿題の丸投げ", sourceLogId: "log-100", updatedAt: "2025-11-25" },
      },
      basics: {},
    },
    sentimentScore: 0.1,
    motivationScore: 64,
    sourceType: "AUDIO",
  },
  {
    id: "log-200",
    studentId: "s-1",
    user: "浅見",
    date: "2025-11-25",
    updatedAt: "2025-11-26 12:45",
    summary:
      "【前半】歴史のテスト振り返り。ワーク暗記はできていたが聞かれ方が変わると崩れることを本人が自覚し、平均点に沈んだ要因を『出題意図を想像していない』『迎撃練習がない』と特定。ChatGPTで類題を作り、5W1Hで深掘りしながら問われ方を想定する方針に合意。"
      + " 【中盤】英語は音読で流れを掴めているが、並び替えや速読で時間を失う不安を共有。音読の質は維持しつつ、問題がどう出されるかを想像して構文を口頭再現する練習を追加することに同意。"
      + " 【終盤】数学は長時間演習が作業化し実戦力に結びついていない点を反省。過去問を使い『どう問われたか』を先に言語化し、解法を声に出して再現しながらタイム計測する“迎撃型”演習に切り替える。全科目で“問題がどう出るかを想像する”チェックを学習計画に埋め込み、平均点から抜け出す戦略を確認。",
    keyQuotes: [
      "「ワークは覚えたのに聞かれ方が違うとボコボコにされた」",
      "「どう出されるかを考える練習を入れたい」",
      "「ChatGPTで問題を作って迎撃練習をしたい」",
      "「音読で流れは分かるが並び替えで落とすのが不安」",
      "「作業で的を撃つ練習だけだと本番で死ぬ。迎撃の練習が足りない」",
      "「出そうな問題を想像するセンサーを鍛えたい」",
      "「平均点祭りから抜け出したい」",
    ],
    keyTopics: [
      "歴史",
      "数学",
      "英語",
      "出題意図",
      "迎撃練習",
      "ChatGPT類題",
      "5W1H",
      "並び替え対策",
      "速読・音読",
      "平均点脱却",
    ],
    nextActions: [
      "歴史：前回テストを持参し、問われ方のパターンを洗い出し→ChatGPTで類題を3問生成し5W1Hで迎撃練習",
      "数学：過去問3問で『どう問われたか』を言語化し、解法再現を音読しながらタイム計測",
      "英語：長文音読＋速読を20分、並び替え問題を想定して構文の流れを口頭再現",
      "全科目：学習計画に“出され方を想像する”チェック欄を追加し、作業化を防ぐ",
    ],
    structuredDelta: {
      personal: {
        motivationSource: {
          value: "出題意図を先読みして迎撃できた実感がモチベになる",
          updatedAt: "2025-11-25",
          sourceLogId: "log-200",
          confidence: 0.74,
        },
        ngApproach: {
          value: "丸暗記と長時間演習だけで出題形式を想定しない学習",
          updatedAt: "2025-11-25",
          sourceLogId: "log-200",
          confidence: 0.7,
        },
      },
      basics: {},
    },
    sentimentScore: 0.05,
    motivationScore: 64,
    sourceType: "MANUAL",
    notes:
      "会話構成メモ: 前半=歴史の問われ方反省と迎撃練習導入。中盤=英語の並び替え・速読不安と音読の質改善。終盤=数学の作業化から脱却し、過去問で出題形式を言語化＋再現演習へ。全科目共通で『出され方を想像するチェック』を学習計画に追加。",
  },
  {
    id: "log-101",
    studentId: "s-1",
    user: "浅見",
    date: "2025-10-26",
    summary:
      "定期テスト振り返り。化学70/数IA56/歴史47/英語60。問われ方が変わると失点する課題を確認し、迎撃練習を設定。",
    keyQuotes: [
      "「頑張ったのに平均点でショック」",
      "「なぜ間違えたかわからない問題が複数」",
      "「聞かれ方が変わるとボコボコにされる」",
    ],
    keyTopics: ["定期テスト", "課題分析", "出題意図", "時間配分"],
    nextActions: [
      "数学：時間配分と解法再現度のチェック",
      "歴史：問われ方の違いに対応する並び替え演習",
      "英語：時間不足解消のため音読＋速読ログを継続",
    ],
    structuredDelta: {
      personal: {},
      basics: {},
    },
    sentimentScore: -0.05,
    motivationScore: 65,
    sourceType: "MANUAL",
  },
  {
    id: "log-102",
    studentId: "s-1",
    user: "浅見",
    date: "2025-09-26",
    summary:
      "定期テストに向け厳しめスケジュールを実行。スマホゲームを手放し、客観性を獲得。雑談で夜型だが旅行前に宿題を前倒しする習慣が判明。",
    keyQuotes: [
      "「スマホゲームの無意味さに気づいて減らした」",
      "「旅行前に宿題を前倒しで終わらせたい」",
    ],
    keyTopics: ["モチベーション", "生活改善", "計画"],
    nextActions: [
      "週次の学習進捗を可視化し、作業化を防ぐ",
      "夜型リズムを踏まえた朝タスクを提案",
    ],
    structuredDelta: {
      personal: {
        lifestyle: { value: "夜型。旅行前倒しで宿題を終わらせたい", sourceLogId: "log-102", updatedAt: "2025-09-26" },
      },
      basics: {},
    },
    sentimentScore: 0.2,
    motivationScore: 70,
    risk: "LOW",
    sourceType: "MANUAL",
  },
  {
    id: "log-103",
    studentId: "s-1",
    user: "浅見",
    date: "2025-08-12",
    summary:
      "夏休みの学習ペース良好。夜型だが22時近くまで学習。旅行までに宿題完了を目指す計画。",
    keyQuotes: [
      "「夏休みはほぼ宿題完了。夜型で22時まで勉強する日も」",
    ],
    keyTopics: ["夏休み", "学習計画", "生活"],
    nextActions: [
      "夏明けテストに向けた仕上げ問題を3回転",
    ],
    structuredDelta: {
      personal: {
        lifestyle: { value: "夜型。22時まで学習。旅行前に宿題完了を目指す", sourceLogId: "log-103", updatedAt: "2025-08-12" },
      },
      basics: {},
    },
    sentimentScore: 0.32,
    motivationScore: 72,
    risk: "LOW",
    sourceType: "MANUAL",
  },
  {
    id: "log-104",
    studentId: "s-2",
    user: "鈴木",
    date: "2025-11-20",
    summary: "英語スピーキング練習を継続。雑談でカフェ・海外ドラマの好みを把握し、音読テーマに反映。",
    keyQuotes: [
      "「カフェで友人と英語ディベートするのが楽しい」",
      "「抹茶スイーツと海外ドラマにハマっている」",
    ],
    keyTopics: ["英語", "スピーキング", "趣味", "ディベート"],
    nextActions: [
      "単語30語を例文付きで暗唱し録音を共有",
      "週末ミニディベートのテーマを3本用意",
    ],
    structuredDelta: {
      personal: {
        favoriteFood: { value: "抹茶スイーツ", sourceLogId: "log-104", updatedAt: "2025-11-20" },
        currentHobby: { value: "カフェ巡り・海外ドラマ・英語ポッドキャスト", sourceLogId: "log-104", updatedAt: "2025-11-20" },
      },
      basics: {},
    },
    sentimentScore: 0.3,
    motivationScore: 76,
    sourceType: "AUDIO",
  },
  {
    id: "log-105",
    studentId: "s-3",
    user: "山本",
    date: "2025-11-22",
    summary: "家庭事情で学習時間が減少。安心感を優先し10分ドリル＋できたこと3つで自己肯定感を回復。",
    keyQuotes: [
      "「夜遅くなる日が多くて勉強時間が減った」",
      "「10分ドリルならできそう」",
      "「できたことを3つメモすると安心する」",
    ],
    keyTopics: ["家庭", "メンタル", "短時間学習"],
    nextActions: [
      "10分ドリルを毎日実施し、できたことを3つ記録",
      "質問をメモして次回の会話で解決",
    ],
    structuredDelta: {
      personal: {
        favoriteFood: { value: "カレーとプリン", sourceLogId: "log-105", updatedAt: "2025-11-22" },
        currentHobby: { value: "アニメとボードゲーム", sourceLogId: "log-105", updatedAt: "2025-11-22" },
        lifestyle: { value: "家庭事情で夜型。短時間学習を優先", sourceLogId: "log-105", updatedAt: "2025-11-22" },
        motivationSource: { value: "小さな成功体験の積み上げ", sourceLogId: "log-105", updatedAt: "2025-11-22" },
      },
      basics: {},
    },
    sentimentScore: -0.1,
    motivationScore: 50,
    sourceType: "AUDIO",
  },
  {
    id: "log-106",
    studentId: "s-4",
    user: "佐藤",
    date: "2025-11-15",
    summary: "理系進学相談。サイエンスカフェや研究ニュース好き。時間管理改善のためタイムトライアル導入。",
    keyQuotes: [
      "「サイエンスカフェの話題が好き」",
      "「タイムトライアルで計算速度を上げたい」",
    ],
    keyTopics: ["進路相談", "理系", "時間管理", "趣味"],
    nextActions: [
      "週2回の物理タイムトライアルを記録しグラフ化",
      "研究室見学の質問を5つ準備",
    ],
    structuredDelta: {
      personal: {
        favoriteFood: { value: "麻婆豆腐とタピオカ", sourceLogId: "log-106", updatedAt: "2025-11-15" },
        currentHobby: { value: "サイエンスカフェ・数学パズル・カメラ", sourceLogId: "log-106", updatedAt: "2025-11-15" },
        motivationSource: { value: "難問突破と称賛", sourceLogId: "log-106", updatedAt: "2025-11-15" },
      },
      basics: {},
    },
    sentimentScore: 0.1,
    motivationScore: 69,
    sourceType: "MANUAL",
  },
];

export const conversationLogTrend = [
  { label: "7月", value: 18 },
  { label: "8月", value: 22 },
  { label: "9月", value: 27 },
  { label: "10月", value: 31 },
  { label: "11月", value: 36 },
  { label: "12月", value: 20 },
];

export const motivationDistribution = [
  { label: "80-100", value: 8, color: "#1d4ed8" },
  { label: "60-79", value: 14, color: "#2563eb" },
  { label: "40-59", value: 7, color: "#3b82f6" },
  { label: "0-39", value: 3, color: "#93c5fd" },
];

export type ReportEntry = {
  title: string;
  content: string;
  date: string;
};

export const parentReports: Record<string, ReportEntry[]> = {
  "s-1": [
    {
      title: "11月度 保護者向けレポート",
      date: "2025-11-26",
      content:
        "（更新：2025/11/26 12:45）浅見作成\n\n11月26日\n前回テストの失点原因を分析し、平均点前後から脱却するための迎撃練習を開始。暗記はできているが出題形式が変わると得点できない傾向が顕著。数学では解法の再現度と時間配分を再設計し、歴史では問われ方の違いに対応するため過去問レビューとChatGPTによる類題生成を導入。ワーク周回よりも『どう問われるか』を意識した勉強にシフト。\n\n9月26日\n無意味なスマホゲームを手放し、厳しめの学習スケジュールを前向きに実行。クラスメイトの課題ごまかしを客観視し、自身の学習姿勢を強化。予習を先取りし、試験を想定した完成度で取り組めている。\n\n8月12日\n夏休みの学習ペースは良好で、宿題はほぼ完了。数学は参考書を併用し、学校教材より一段上のレベルで復習。家族旅行までに宿題完了を目指し、夜型ながら高3生に混ざって22時近くまで学習する日も。",
    },
    {
      title: "10月度 振り返り",
      date: "2025-10-30",
      content:
        "テスト返却を受けて平均点前後でショック。問われ方が変わると得点できない課題が顕在化。数学は解法の再現度、歴史は並び替えや問われ方への対応を強化。勉強が『作業化』しないよう、出題意図を想定した演習に切り替え中。",
    },
  ],
  "s-2": [
    {
      title: "11月度 保護者向けレポート",
      date: "2025-11-20",
      content:
        "英語の発音・表現に自信がつき、スピーキング練習を継続中。語彙の抜けを確認しながら週末ディベートに向けてテーマを選定。1日30語の音読＋例文練習を習慣化。ご家庭では録音を聞いてフィードバックを一言添えていただけると、さらにモチベーションが高まります。",
    },
  ],
  "s-3": [
    {
      title: "11月度 保護者向けレポート",
      date: "2025-11-22",
      content:
        "家庭事情で学習時間が減少。安心感を優先しつつ、10分ドリルと『できたこと3つ』確認で自己肯定感を回復中。短時間でも継続できる課題を設定し、疑問はメモして面談で解決する運用に。",
    },
  ],
  "s-4": [
    {
      title: "11月度 保護者向けレポート",
      date: "2025-11-15",
      content:
        "理系進学を視野に、冬休みのオープンキャンパスを計画。物理計算に時間がかかるため、タイムトライアルで処理速度を向上中。研究室見学で質問したい内容を整理し、進路検討を具体化しています。",
    },
  ],
};

export function getStudentById(id: string) {
  return students.find((s) => s.id === id);
}

export function getConversationById(id: string) {
  return conversationLogs.find((c) => c.id === id);
}

export function getConversationsByStudentId(studentId: string) {
  return conversationLogs.filter((c) => c.studentId === studentId);
}

export function getReportByStudentId(id: string) {
  return parentReports[id] ?? [];
}

export function getProfileCompleteness(profile: StudentProfileData): number {
  const fields = [
    ...Object.values(profile.personal ?? {}),
    ...Object.values(profile.basics ?? {}),
  ];
  const filled = fields.filter((f) => f?.value?.length).length;
  const total = Math.max(fields.length, 1);
  return Math.round((filled / total) * 100);
}
