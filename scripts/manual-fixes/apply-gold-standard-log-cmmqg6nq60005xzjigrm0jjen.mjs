import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const conversationId = "cmmqg6nq60005xzjigrm0jjen";

const summaryMarkdown = `## 会話で確認できた事実
- 数学は毎日触る前提を維持しつつ、限られた時間の中で演習の優先順位を上げる必要がある。
- 模試や過去問で弱点は見えている一方、課題が分かっても点数に結びつかない感覚が続いている。
- 特に初見問題で「何から考えるか」が曖昧になり、答えを見れば理解できるのに本番で再現できない場面がある。
- 確率など毎回崩れやすい単元は、過去問だけでなく補強用の問題集で練習する選択肢が出ている。
- 共通テスト対策はまだ十分でなく、予想問題集の活用や、いつから比重を上げるかの設計が必要になっている。

## 指導の要点（講師が伝えた核）
- いま不足しているのは単なる知識量よりも、初見問題での立ち回りと振り返りの質である。
- 復習は参考書に戻ることだけではなく、解けなかった場面で自分が何を考え、何が抜けたかを言葉にして残すことが重要。
- ベクトルなら直角や一次独立、数列なら1・2・3の代入、微分なら元の式の確認など、問題タイプごとに最初の一手をメモとして蓄積する。
- 1回の演習ごとに一つでも「次に同じ場面が来たらこうする」を増やせば、演習が勉強として積み上がる。
- インプットを積んできた時期だからこそ、ここでアウトプットを減らすのは避けた方がよい。

## 次回までの方針
- 数学の初見演習を解いた日は、止まった理由と「次に最初にやること」を必ず1件メモする。
- 確率など毎回崩れる単元は、解けるレベルの問題集で補強し、共通する詰まりを整理する。
- 共通テスト対策は科目ごとの過去問の流れに組み込み、使う教材と切り替え時期を早めに決める。
- 次回は記録した思考メモを見ながら、再現できた一手とまだ出ない一手を確認する。`;

const timelineJson = [
  {
    title: "日々の学習の前提と時間配分",
    what_happened:
      "数学は毎日続ける前提だが、時間不足の中で模試・過去問・復習の優先順位をより明確にする必要がある。",
    coach_point: "量を増やすより、限られた時間を得点に結びつく演習へ寄せる。",
    student_state: "毎日回す意思はあるが、時間不足で配分に迷いが出やすい。",
    evidence_quotes: [
      "毎日数学だけはやる。",
      "時間ないやん。",
      "模試やった結果過去問やってないですみたいになると結構まずいよね。",
    ],
  },
  {
    title: "得点が伸び切らない原因の整理",
    what_happened:
      "課題は把握できても点数に反映されない背景として、初見問題での思考回路や判断の弱さが主因と整理された。",
    coach_point: "知識不足よりも「解くときの動き方」を直す視点が必要。",
    student_state: "答えを見れば理解できる一方、本番で最初の一手が出にくい。",
    evidence_quotes: [
      "課題ばっかり分かって点は上がらないって感じ。",
      "初見の問題は解いているときの立ち回り方の問題。",
      "答え見て読めたら。できるじゃん。なのに本番できてないから。",
    ],
  },
  {
    title: "復習方法の更新",
    what_happened:
      "復習は参考書に戻るだけでなく、問題タイプごとに最初の一手や判断基準を言語化して蓄積する方針になった。",
    coach_point: "演習ごとに一つでも「次はこうする」を残し、思考メモを増やす。",
    student_state: "知識は持っているが、使い方を言葉で固定すると伸びやすい。",
    evidence_quotes: [
      "次ベクトル問題来たらとにかくこれはやろうみたいな、直角を探そうとか。",
      "数列と問題がきたらとにかく1,2,3で代入しようとか。",
      "そういうのは書いていったほうが確実かも。",
    ],
  },
  {
    title: "共通テスト対策の入れ方",
    what_happened:
      "共通テスト型の演習は早めに組み込みつつ、私大対策と中途半端に切り替えず、時期を決めて比重を寄せる方針を確認した。",
    coach_point: "使う教材と開始時期を先に決め、直前期は形式をぶらさない。",
    student_state: "対策の必要性は分かっているが、切り替えの設計を早めに固めたい。",
    evidence_quotes: [
      "予想問題集をどれか。買うのはありかもしれない。",
      "共通の過去問と私大の過去問と同時にはできないでしょ。",
      "1月入ってからやっぱ私大の対策とかやんないほうがいい。",
    ],
  },
];

const nextActionsJson = [
  {
    owner: "STUDENT",
    action: "数学の初見演習を解いた日は、止まった理由と「次に最初にやること」を1件メモする。",
    due: null,
    metric: "次回までに思考メモが3件以上あり、各メモに「止まった理由」「次にやる一手」が入っている。",
    why: "思考回路の癖を直さないと、弱点だけ分かっても点数が伸びないため。",
  },
  {
    owner: "STUDENT",
    action: "確率など毎回崩れやすい単元を、解けるレベルの問題集で補強する。",
    due: null,
    metric: "同じ単元を3題以上解き、共通する詰まりを1つ言語化する。",
    why: "過去問だけでは再現しにくい弱点を、解けるレベルから立て直すため。",
  },
  {
    owner: "STUDENT",
    action: "共通テスト型演習を入れる時期と使う教材を決め、週のどこで回すかを決める。",
    due: null,
    metric: "次回までの学習計画に共通テスト演習の枠と教材名が入っている。",
    why: "私大対策と並行しても、共通テスト特有の形式に慣れる時間を確保する必要があるため。",
  },
  {
    owner: "COACH",
    action: "次回は記録した思考メモを見ながら、再現できた一手とまだ出ない一手を整理する。",
    due: null,
    metric: "再現できた一手1つ、まだ出ない一手1つを確認する。",
    why: "演習量ではなく、解くときの判断を更新できているかを確認したいため。",
  },
];

const profileDeltaJson = {
  basic: [
    {
      field: "学習の軸",
      value: "数学は毎日触る前提で進める。",
      confidence: 86,
      evidence_quotes: ["毎日数学だけはやる。"],
    },
    {
      field: "使用教材",
      value: "過去問に加えて、弱点補強用の問題集や共通テスト予想問題集の活用を検討している。",
      confidence: 82,
      evidence_quotes: [
        "予想問題集をどれか。買うのはありかもしれない。",
        "だったら確率の問題を問題集で解いたりとかして、できるレベルのやつ探して。",
      ],
    },
    {
      field: "次回確認事項",
      value: "思考メモの蓄積状況と、共通テスト対策の導入時期を確認する。",
      confidence: 84,
      evidence_quotes: [
        "だから本当は書いてった方がいいと思うねん。",
        "だから強いて時期って言われると、なるはやじゃない?",
      ],
    },
  ],
  personal: [
    {
      field: "学習スタイル",
      value: "インプットは積んできた一方、初見問題での立ち回りを言語化する復習が弱い。",
      confidence: 89,
      evidence_quotes: [
        "課題ばっかり分かって点は上がらないって感じ。",
        "初見の問題は解いているときの立ち回り方の問題。",
      ],
    },
    {
      field: "つまずき傾向",
      value: "答えを見れば理解できるが、本番では最初の一手が出ずに止まりやすい。",
      confidence: 90,
      evidence_quotes: [
        "答え見て読めたら。できるじゃん。なのに本番できてないから。",
        "ベクトル問題解こうとして、何も思いつかねーみたいな。",
      ],
    },
    {
      field: "課題単元",
      value: "確率など、毎回崩れやすい単元がある。",
      confidence: 74,
      evidence_quotes: ["毎回確率できねえんだよ。", "毎回確率合わねえみたいな。"],
    },
  ],
};

const parentPackJson = {
  what_we_did: [
    "得点が伸び切らない原因を、知識量ではなく初見問題での立ち回りという観点で整理した。",
    "復習のやり方を、参考書に戻るだけでなく思考メモを残す形に更新した。",
    "共通テスト対策をいつから入れるかの考え方を確認した。",
  ],
  what_improved: [
    "何が足りないかが「弱点の把握」ではなく「最初の一手の言語化」だと明確になった。",
    "問題ごとに次の行動をメモとして残す方向性が具体化した。",
  ],
  what_to_practice: ["初見演習後の思考メモ作成", "確率など崩れやすい単元の補強", "共通テスト型演習の導入"],
  risks_or_notes: [
    "アウトプットを減らすと、得点化の伸びが鈍りやすい。",
    "私大対策と共通テスト対策の切り替えが中途半端になると効率が落ちやすい。",
  ],
  next_time_plan: [
    "思考メモが実際に書けたか確認する。",
    "崩れやすい単元の補強状況を確認する。",
    "共通テスト対策を入れる時期と教材を確定する。",
  ],
  evidence_quotes: [
    "課題ばっかり分かって点は上がらないって感じ。",
    "だから本当は書いてった方がいいと思うねん。",
    "予想問題集をどれか。買うのはありかもしれない。",
  ],
};

const studentStateJson = {
  label: "詰まり",
  oneLiner: "知識はあるが、初見問題で最初の一手が出にくい。",
  rationale: [
    "課題ばっかり分かって点は上がらないって感じ。",
    "初見の問題は解いているときの立ち回り方の問題。",
    "答え見て読めたら。できるじゃん。なのに本番できてないから。",
  ],
  confidence: 88,
};

const topicSuggestionsJson = [
  {
    category: "学習",
    title: "初見問題で止まる瞬間の整理",
    reason: "知識量よりも「最初の一手が出ないこと」が主な詰まりとして見えているため。",
    question: "最近の演習で「何も思いつかない」となったのはどの問題だった？",
    priority: 1,
  },
  {
    category: "学習",
    title: "思考メモの書き方確認",
    reason: "ベクトル・数列・微分で最初に見るポイントを言語化して残す方針が出ているため。",
    question: "ベクトルや数列で、次から最初に確認することを何て書く？",
    priority: 2,
  },
  {
    category: "学習",
    title: "確率など崩れやすい単元の補強",
    reason: "毎回崩れる単元は、過去問だけでなく補強演習を入れる必要があるため。",
    question: "今いちばん補強したい単元は、確率以外にどこがある？",
    priority: 3,
  },
  {
    category: "学習",
    title: "毎日数学の回し方",
    reason: "継続の意思はあるため、演習と振り返りの比率を整えると成果につながりやすいため。",
    question: "毎日数学をやる枠で、演習と振り返りをどう分ける？",
    priority: 4,
  },
  {
    category: "進路",
    title: "共通テスト対策を入れる時期",
    reason: "私大対策と並行しつつ、共通テスト特有の形式にも早めに慣れる必要があるため。",
    question: "共通テスト型の演習を、今の週のどこに入れるのが現実的？",
    priority: 5,
  },
  {
    category: "進路",
    title: "私大対策との切り替え方",
    reason: "直前期に対策をコロコロ変えない準備が必要なため。",
    question: "1月に入ったら何をやめて、何を残す想定でいる？",
    priority: 6,
  },
];

const quickQuestionsJson = [
  {
    category: "学習",
    question: "最近の演習で、最初の一手が出なかったのはどの問題？",
    reason: "思考が止まる場面を具体化したい。",
  },
  {
    category: "学習",
    question: "ベクトルが来たら最初に何を見る？",
    reason: "解法メモが実戦で出るか確認したい。",
  },
  {
    category: "学習",
    question: "確率はどこで毎回止まる？",
    reason: "補強する単元の焦点を絞りたい。",
  },
  {
    category: "進路",
    question: "共通テスト演習を今週どこに入れる？",
    reason: "切り替え時期を曖昧にしないため。",
  },
  {
    category: "進路",
    question: "1月に入ったら何をやめて何を残す？",
    reason: "直前期の方針を先に固めたい。",
  },
];

const profileSectionsJson = [
  {
    category: "学習",
    status: "維持",
    highlights: [
      { label: "毎日数学", value: "数学は毎日触る前提を維持したい。", isNew: true, isUpdated: false },
      { label: "初見問題の復習", value: "答えを見る前の思考回路を振り返る必要がある。", isNew: true, isUpdated: false },
      { label: "解法メモ", value: "問題タイプごとに最初の一手を言語化して蓄積する。", isNew: true, isUpdated: false },
    ],
    nextQuestion: "最近の演習で、記録に残したい「最初の一手」は何だった？",
  },
  {
    category: "生活",
    status: "維持",
    highlights: [
      { label: "時間の制約", value: "限られた時間の中で、演習の優先順位を絞る必要がある。", isNew: true, isUpdated: false },
    ],
    nextQuestion: "演習後の振り返り時間を、1日のどこで確保できそう？",
  },
  {
    category: "進路",
    status: "維持",
    highlights: [
      { label: "共通テスト対策", value: "導入時期と使う教材を早めに決める必要がある。", isNew: true, isUpdated: false },
      { label: "直前期の切り替え", value: "1月以降は形式をコロコロ変えず、比重を定めて進めたい。", isNew: true, isUpdated: false },
    ],
    nextQuestion: "共通テスト対策を本格化する時期を、どこで切る想定？",
  },
];

const observationJson = [
  {
    sourceType: "INTERVIEW",
    category: "学習",
    statusDraft: "維持",
    insights: [
      "知識量より、初見問題での立ち回りが得点化のボトルネックになっている。",
      "演習後に最初の一手を言語化して蓄積する必要がある。",
    ],
    topics: ["初見問題で止まる瞬間の整理", "思考メモの書き方確認", "確率など崩れやすい単元の補強"],
    nextActions: [
      "数学の初見演習を解いた日は、止まった理由と「次に最初にやること」を1件メモする。",
      "確率など毎回崩れやすい単元を、解けるレベルの問題集で補強する。",
    ],
    evidence: [
      "課題ばっかり分かって点は上がらないって感じ。",
      "初見の問題は解いているときの立ち回り方の問題。",
    ],
    characterSignal: "知識はあるが、初見で最初の一手が出にくい。",
    weight: 5,
  },
  {
    sourceType: "INTERVIEW",
    category: "生活",
    statusDraft: "維持",
    insights: ["時間が限られる中で、演習と振り返りの優先順位づけが必要になっている。"],
    topics: ["毎日数学の回し方"],
    nextActions: ["数学の初見演習を解いた日は、止まった理由と「次に最初にやること」を1件メモする。"],
    evidence: ["時間ないやん。", "毎日数学だけはやる。"],
    characterSignal: "継続の意思はあるが、時間配分で迷いやすい。",
    weight: 3,
  },
  {
    sourceType: "INTERVIEW",
    category: "進路",
    statusDraft: "維持",
    insights: ["共通テスト対策をいつ入れるか、早めに設計しておく必要がある。"],
    topics: ["共通テスト対策を入れる時期", "私大対策との切り替え方"],
    nextActions: ["共通テスト型演習を入れる時期と使う教材を決め、週のどこで回すかを決める。"],
    evidence: [
      "共通の過去問と私大の過去問と同時にはできないでしょ。",
      "1月入ってからやっぱ私大の対策とかやんないほうがいい。",
    ],
    characterSignal: "切り替えの設計を早めに固めたい。",
    weight: 4,
  },
];

const entityCandidatesJson = [
  {
    kind: "EXAM",
    status: "PENDING",
    rawValue: "共通テスト",
    canonicalValue: "共通テスト",
    confidence: 88,
    context: "共通テスト型演習の入れ方と切り替え時期を相談している。",
  },
  {
    kind: "EXAM",
    status: "PENDING",
    rawValue: "センター試験",
    canonicalValue: "センター試験",
    confidence: 74,
    context: "共通テストとの形式差を説明する文脈で言及。",
  },
  {
    kind: "MATERIAL",
    status: "PENDING",
    rawValue: "過去問",
    canonicalValue: "過去問",
    confidence: 86,
    context: "模試後の演習と復習の中心教材として言及。",
  },
  {
    kind: "MATERIAL",
    status: "PENDING",
    rawValue: "共通テスト予想問題集",
    canonicalValue: "共通テスト予想問題集",
    confidence: 82,
    context: "共通テスト型の演習量を補う候補として話題に出ている。",
  },
  {
    kind: "MATERIAL",
    status: "PENDING",
    rawValue: "弱点補強用問題集",
    canonicalValue: "問題集",
    confidence: 68,
    context: "確率など毎回崩れやすい単元の補強用として言及。",
  },
];

async function main() {
  const existing = await prisma.conversationLog.findUnique({
    where: { id: conversationId },
    select: { qualityMetaJson: true },
  });

  const qualityMetaJson = {
    ...(existing?.qualityMetaJson || {}),
    manualGoldStandard: true,
    manualGoldStandardAt: new Date().toISOString(),
    manualGoldStandardSource: "docs/gold-standard-cmmqg6nq60005xzjigrm0jjen.md",
    summaryCharCount: summaryMarkdown.length,
    timelineSectionCount: timelineJson.length,
    todoCount: nextActionsJson.length,
    topicCount: topicSuggestionsJson.length,
  };

  const updated = await prisma.conversationLog.update({
    where: { id: conversationId },
    data: {
      status: "DONE",
      summaryMarkdown,
      timelineJson,
      nextActionsJson,
      profileDeltaJson,
      parentPackJson,
      studentStateJson,
      topicSuggestionsJson,
      quickQuestionsJson,
      profileSectionsJson,
      observationJson,
      entityCandidatesJson,
      qualityMetaJson,
    },
    select: {
      id: true,
      status: true,
      summaryMarkdown: true,
      studentStateJson: true,
      topicSuggestionsJson: true,
      nextActionsJson: true,
      profileSectionsJson: true,
      qualityMetaJson: true,
    },
  });

  console.log(
    JSON.stringify(
      {
        id: updated.id,
        status: updated.status,
        startsWithExpected: updated.summaryMarkdown?.startsWith("## 会話で確認できた事実") ?? false,
        hasQuestionRuns: /\?{4,}/.test(updated.summaryMarkdown ?? ""),
        nextActionCount: Array.isArray(updated.nextActionsJson) ? updated.nextActionsJson.length : 0,
        topicCount: Array.isArray(updated.topicSuggestionsJson) ? updated.topicSuggestionsJson.length : 0,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
