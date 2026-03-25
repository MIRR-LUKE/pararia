import assert from "node:assert/strict";
import {
  ConversationSourceType,
  SessionPartStatus,
  SessionPartType,
  SessionType,
} from "@prisma/client";

process.env.LLM_API_KEY ??= "test-key";
process.env.OPENAI_API_KEY ??= process.env.LLM_API_KEY;
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/pararia_test";
process.env.DIRECT_URL ??= process.env.DATABASE_URL;
process.env.ANALYZE_BATCH_SIZE = "1";
process.env.ANALYZE_BATCH_CONCURRENCY = "1";
process.env.ENABLE_FINALIZE_REPAIR = "0";

type MockMode = "INTERVIEW" | "LESSON_REPORT";
type MockPhase = "analyze" | "reduce" | "finalize" | "single-pass";

type RequestLogItem = {
  phase: MockPhase;
  mode: MockMode;
};

const requestLog: RequestLogItem[] = [];
const originalFetch = globalThis.fetch;

function detectMode(prompt: string): MockMode {
  return prompt.includes("セッション種別: LESSON_REPORT") || prompt.includes("指導報告ログ")
    ? "LESSON_REPORT"
    : "INTERVIEW";
}

function detectPhase(prompt: string): MockPhase {
  if (prompt.includes("対象チャンク #") || prompt.includes("会話チャンク #")) return "analyze";
  if (prompt.includes("入力 evidence JSON:") || prompt.includes("チャンク分析:")) return "reduce";
  if (prompt.includes("入力 reduced evidence JSON:") || prompt.includes("Reduced evidence JSON:")) return "finalize";
  if (prompt.includes("文字起こし:")) return "single-pass";
  throw new Error(`Unknown mock phase:\n${prompt.slice(0, 400)}`);
}

function buildChunkAnalysis(mode: MockMode) {
  if (mode === "LESSON_REPORT") {
    return {
      facts: [
        "授業前に英語長文で設問の根拠を拾い切れない不安が共有された。",
        "授業後には本文の段落ごとの役割を押さえると正答率が上がった。",
      ],
      coaching_points: [
        "段落ごとの役割を先に捉えてから設問に戻る読み方を指導した。",
      ],
      decisions: [
        "宿題では音読と根拠線引きをセットで行う方針にした。",
      ],
      student_state_delta: [
        "授業前は不安が強かったが、授業後は解き方の再現手順が見えた。",
      ],
      todo_candidates: [
        {
          owner: "STUDENT",
          action: "英語長文を一日一題読み、根拠に線を引く。",
          due: null,
          metric: "五日分の本文で根拠線引きを残す。",
          why: "設問の根拠を本文から拾う再現性を高めるため。",
          evidence_quotes: ["根拠をどこで拾うかがまだ曖昧だった。"],
        },
        {
          owner: "COACH",
          action: "次回授業の冒頭で線引きの位置を一緒に確認する。",
          due: null,
          metric: "迷った設問を一題選び、根拠位置を説明できる。",
          why: "授業中の理解が宿題でも再現できるか確認するため。",
          evidence_quotes: ["授業後は根拠を言える場面が増えた。"],
        },
      ],
      timeline_candidates: [
        {
          title: "授業前の詰まり確認",
          what_happened: "英語長文で設問の根拠を本文から拾い切れない不安が共有された。",
          coach_point: "どこで迷ったかを先に言葉にしてから読み始めるよう促した。",
          student_state: "授業前は設問を読む段階で手が止まりやすかった。",
          evidence_quotes: ["根拠をどこで拾うかがまだ曖昧だった。"],
        },
        {
          title: "授業後の再現確認",
          what_happened: "段落ごとの役割を押さえると正答率が上がり、解き方の手順が整理された。",
          coach_point: "音読と根拠線引きを宿題でも同じ順番で続けるよう整理した。",
          student_state: "授業後は解き方を言葉で再現しやすくなった。",
          evidence_quotes: ["授業後は根拠を言える場面が増えた。"],
        },
      ],
      profile_delta_candidates: {
        basic: [
          {
            field: "学習状況",
            value: "英語長文では根拠を本文に戻して確認する練習が必要。",
            confidence: 83,
            evidence_quotes: ["根拠をどこで拾うかがまだ曖昧だった。"],
          },
        ],
        personal: [
          {
            field: "取り組み姿勢",
            value: "手順が見えると表情が落ち着き、説明しながら進められる。",
            confidence: 74,
            evidence_quotes: ["授業後は根拠を言える場面が増えた。"],
          },
        ],
      },
      quotes: [
        "根拠をどこで拾うかがまだ曖昧だった。",
        "授業後は根拠を言える場面が増えた。",
      ],
      safety_flags: [],
    };
  }

  return {
    facts: [
      "模試の数学で最初の一手が出ずに止まる問題があった。",
      "英語は音読を続けた日は読み直しが減る感覚がある。",
    ],
    coaching_points: [
      "数学は止まった瞬間を言葉で残し、次回の面談で一緒に見直す方針を伝えた。",
    ],
    decisions: [
      "英語は短時間でも音読を継続し、数学は誤答の最初の一手を記録することにした。",
    ],
    student_state_delta: [
      "不安はあるが、改善の手順が見えると前向きに動ける状態だった。",
    ],
    todo_candidates: [
      {
        owner: "STUDENT",
        action: "数学で止まった一題を選び、最初の一手をメモする。",
        due: null,
        metric: "次回までに一題分の思考メモを残す。",
        why: "どこで止まったかを面談で振り返れるようにするため。",
        evidence_quotes: ["最初の一手が出ずに止まる問題があった。"],
      },
      {
        owner: "STUDENT",
        action: "英語の音読を五日続け、読み直し回数を減らす。",
        due: null,
        metric: "五日分の音読記録を残す。",
        why: "読む速度を落とさず意味を取る感覚を維持するため。",
        evidence_quotes: ["音読を続けた日は読み直しが減る感覚がある。"],
      },
    ],
    timeline_candidates: [
      {
        title: "模試後の不安整理",
        what_happened: "模試の数学で最初の一手が出ずに止まる場面が共有された。",
        coach_point: "止まった瞬間を言葉で残し、次回面談の材料にするよう伝えた。",
        student_state: "不安は強いが、言語化すると落ち着いて整理できていた。",
        evidence_quotes: ["最初の一手が出ずに止まる問題があった。"],
      },
      {
        title: "英語学習の手応え確認",
        what_happened: "英語は音読を続けた日に読み直しが減る実感が共有された。",
        coach_point: "短時間でも継続して、速度よりも止まらない感覚を優先すると整理した。",
        student_state: "手応えがある方法には前向きに取り組めそうだった。",
        evidence_quotes: ["音読を続けた日は読み直しが減る感覚がある。"],
      },
    ],
    profile_delta_candidates: {
      basic: [
        {
          field: "学習状況",
          value: "数学は初手の整理が課題で、英語は音読の継続が効果につながりそう。",
          confidence: 82,
          evidence_quotes: ["最初の一手が出ずに止まる問題があった。"],
        },
      ],
      personal: [
        {
          field: "気持ちの動き",
          value: "不安はあるが、改善手順が見えると前向きに動きやすい。",
          confidence: 76,
          evidence_quotes: ["不安はあるが、改善の手順が見えると前向きに動ける状態だった。"],
        },
      ],
    },
    quotes: [
      "最初の一手が出ずに止まる問題があった。",
      "音読を続けた日は読み直しが減る感覚がある。",
    ],
    safety_flags: [],
  };
}

function buildReduced(mode: MockMode) {
  const analysis = buildChunkAnalysis(mode);
  return {
    facts: analysis.facts,
    coaching_points: analysis.coaching_points,
    decisions: analysis.decisions,
    student_state_delta: analysis.student_state_delta,
    todo_candidates: analysis.todo_candidates,
    timeline_candidates: analysis.timeline_candidates,
    profile_delta_candidates: analysis.profile_delta_candidates,
    quotes: analysis.quotes,
    safety_flags: analysis.safety_flags,
  };
}

function buildFinalizeResult(mode: MockMode) {
  if (mode === "LESSON_REPORT") {
    return {
      summaryMarkdown: [
        "■ 基本情報",
        "対象生徒: 田中 花 様。",
        "指導日: 2026年3月25日。",
        "教科・単元: 英語 / 長文読解。",
        "担当チューター: 伊藤先生。",
        "■ 1. 本日の指導サマリー（室長向け要約）",
        "授業前には英語長文で根拠を拾い切れない不安が共有され、授業後には段落ごとの役割を押さえると正答率が上がることを確認できた。本文の役割を先に捉える読み方を整理し、判断順の再現性を次回以降の焦点として共有した。",
        "本人は読み方の筋道が見えると落ち着いて説明できる一方、設問だけを追うと再び本文のどこを見るべきかが曖昧になりやすく、宿題でも同じ順番を守れるかが重要である。",
        "■ 2. 課題と指導成果（Before → After）",
        "【英語長文】根拠位置の判断。",
        "現状（Before）: 設問だけを追うと本文のどこに戻ればよいかが曖昧で、根拠を拾い切れない不安が残っていた。",
        "成果（After）: 段落ごとの役割を押さえてから設問に戻る流れを整理し、根拠位置を言葉で説明する場面が増えた。",
        "※特記事項: 読み方の順序を言語化すると理解が安定するため、宿題でも本文の役割確認を先に置く方が再現しやすい。",
        "【宿題設計】再現練習の優先順位。",
        "現状（Before）: 宿題では量をこなしても、どこで迷ったかを残さないため、次回授業に不安が持ち越されやすかった。",
        "成果（After）: 迷った設問を一題だけ明確に残し、判断順を再現できるかを次回確認する設計に整理できた。",
        "■ 3. 学習方針と次回アクション（自学習の設計）",
        "次回までは、音読と根拠線引きをセットで続け、迷った設問を一題持参する。",
        "量を増やすよりも、迷った設問を明確に残し、判断順を再現できるかを優先して確認する方針で進める。",
        "次回までの宿題:",
        "- 英語長文は一日一題を目安に音読と根拠線引きを続ける。",
        "次回の確認（テスト）事項:",
        "- 迷った設問を一題確認し、判断順を再現できるかを見る。",
        "■ 4. 室長・他講師への共有・連携事項",
        "現時点で強い介入は不要だが、本文の役割を先に捉える手順の定着確認は継続したい。",
        "他教科でも、解き方を口頭で一度説明させる確認を入れると、理解したつもりの抜けを早めに拾いやすい。",
      ].join("\n"),
      timeline: [
        {
          title: "授業前の不安確認",
          what_happened: "授業前に英語長文で設問の根拠を拾い切れない不安が共有された。",
          coach_point: "どこで迷うかを言葉にしてから本文へ戻る順番を整理した。",
          student_state: "授業前は設問の根拠に戻るところで手が止まりやすかった。",
          evidence_quotes: ["根拠をどこで拾うかがまだ曖昧だった。"],
        },
        {
          title: "授業中の読み方整理",
          what_happened: "段落ごとの役割を先に押さえると、設問の根拠位置を特定しやすくなった。",
          coach_point: "本文の役割を先に捉えてから設問に戻る読み方を反復した。",
          student_state: "途中から解き方の順番が見えて、説明しながら進められていた。",
          evidence_quotes: ["授業後は根拠を言える場面が増えた。"],
        },
        {
          title: "授業後の宿題確認",
          what_happened: "宿題では音読と根拠線引きをセットで続ける方針を確認した。",
          coach_point: "次回授業の冒頭で迷った設問を一題確認する約束まで置いた。",
          student_state: "授業後は次回までに何をやるかが明確になっていた。",
          evidence_quotes: ["授業後は根拠を言える場面が増えた。"],
        },
      ],
      nextActions: [
        {
          owner: "STUDENT",
          action: "英語長文を一日一題読み、根拠に線を引く。",
          due: null,
          metric: "五日分の本文で根拠線引きを残す。",
          why: "授業中に整理した読み方を宿題でも再現できるようにするため。",
        },
        {
          owner: "STUDENT",
          action: "迷った設問を一題選び、どこで止まったかをメモする。",
          due: null,
          metric: "次回授業で一題分の迷いどころを説明できる。",
          why: "授業前後でどの場面がまだ曖昧かを見極めるため。",
        },
        {
          owner: "COACH",
          action: "次回授業の冒頭で根拠位置と判断順を一緒に確認する。",
          due: null,
          metric: "迷った設問一題で根拠位置と判断順を再現できる。",
          why: "今回の理解が宿題でも保てているかを確認するため。",
        },
      ],
      profileDelta: {
        basic: [
          {
            field: "学習状況",
            value: "英語長文は段落の役割を先に捉えると設問の根拠に戻りやすくなる。",
            confidence: 86,
            evidence_quotes: ["授業後は根拠を言える場面が増えた。"],
          },
        ],
        personal: [
          {
            field: "取り組み姿勢",
            value: "手順が見えると落ち着いて説明しながら取り組める。",
            confidence: 78,
            evidence_quotes: ["授業後は根拠を言える場面が増えた。"],
          },
        ],
      },
      parentPack: {
        what_we_did: [
          "英語長文で設問の根拠を本文に戻って探す読み方を整理しました。",
        ],
        what_improved: [
          "段落の役割を押さえると、解答の根拠を言葉で説明できる場面が増えました。",
        ],
        what_to_practice: [
          "宿題では音読と根拠線引きを同じ順番で続けてください。",
        ],
        risks_or_notes: [
          "設問だけを追うと再び根拠を見失いやすいため、本文の役割確認を先に置く必要があります。",
        ],
        next_time_plan: [
          "次回授業では迷った設問を一題確認し、根拠位置の再現性を見ます。",
        ],
        evidence_quotes: ["授業後は根拠を言える場面が増えた。"],
      },
      studentState: {
        label: "前進",
        oneLiner: "不安はあるが、解き方の順番が見えると再現しやすい状態だった。",
        rationale: [
          "授業前後で表情の硬さが和らぎ、説明しながら進められていた。",
          "次回までの宿題と確認項目を自分の言葉で言い直せていた。",
        ],
        confidence: 79,
      },
      recommendedTopics: [
        {
          category: "学習",
          title: "根拠線引きの再現性",
          reason: "授業中に整理した読み方が宿題でも再現できるか確認したいため。",
          question: "根拠線引きで迷った設問はどこだった？",
          priority: 1,
        },
        {
          category: "学習",
          title: "段落役割の捉え方",
          reason: "本文の役割を先に捉える読み方が定着すると正答率が安定しやすいため。",
          question: "段落ごとの役割を先に見る流れは続けられた？",
          priority: 2,
        },
        {
          category: "生活",
          title: "宿題を回す時間帯",
          reason: "音読と線引きを安定して続ける時間帯を決めると習慣化しやすいため。",
          question: "宿題はどの時間帯なら続けやすそう？",
          priority: 3,
        },
      ],
      quickQuestions: [
        {
          category: "学習",
          question: "迷った設問は一題に絞れた？",
          reason: "次回授業で確認する題材を早く決めるため。",
        },
        {
          category: "生活",
          question: "音読は何日続けられた？",
          reason: "宿題の継続状況を短時間で把握するため。",
        },
      ],
      profileSections: [
        {
          category: "学習",
          status: "改善",
          highlights: [
            {
              label: "英語長文の読み方",
              value: "段落の役割を先に押さえると根拠位置を説明しやすくなった。",
              isNew: true,
              isUpdated: true,
            },
          ],
          nextQuestion: "宿題でも同じ順番で読めたか、次回もう一段確認したい。",
        },
        {
          category: "生活",
          status: "維持",
          highlights: [
            {
              label: "宿題の回し方",
              value: "短時間でも毎日続けられる時間帯を整える必要がある。",
              isNew: true,
              isUpdated: false,
            },
          ],
          nextQuestion: "音読と線引きを入れやすい時間帯を次回確認したい。",
        },
      ],
      observationEvents: [
        {
          sourceType: "LESSON_REPORT",
          category: "学習",
          statusDraft: "改善",
          insights: [
            "段落の役割を先に見ると根拠位置を説明しやすくなった。",
          ],
          topics: ["英語長文", "根拠線引き"],
          nextActions: [
            "音読と根拠線引きを五日分続ける。",
            "迷った設問を一題持参する。",
          ],
          evidence: ["授業後は根拠を言える場面が増えた。"],
          characterSignal: "手順が見えると落ち着いて再現しやすい。",
          weight: 2,
        },
      ],
      lessonReport: {
        todayGoal: "英語長文で根拠を本文から拾う流れを再現できるようにする。",
        covered: [
          "段落ごとの役割を先に捉えてから設問へ戻る読み方",
          "本文への根拠線引きと説明の順番",
        ],
        blockers: [
          "設問だけを追うと本文の根拠位置を見失いやすい。",
        ],
        homework: [
          "英語長文を一日一題読み、根拠に線を引く。",
          "迷った設問を一題選び、どこで止まったかをメモする。",
        ],
        nextLessonFocus: [
          "根拠位置と判断順を迷わず説明できるか確認する。",
        ],
        parentShareDraft: "授業では英語長文の根拠を本文に戻って探す読み方を整理しました。宿題でも音読と線引きを続け、次回授業で再現性を確認します。",
      },
    };
  }

  return {
    summaryMarkdown: [
      "■ 基本情報",
      "対象生徒: 山田 太郎 様",
      "面談日: 2026年3月25日",
      "面談時間: 未記録",
      "担当チューター: 佐藤",
      "面談目的: 学習状況の確認と次回方針の整理",
      "",
      "■ 1. サマリー",
      "模試の数学では最初の一手が出ずに止まる問題があり、英語は音読を続けた日に読み直しが減る実感が共有された。今回の面談では、数学は止まった瞬間を記録して次回面談で思考の流れを見直すこと、英語は短時間でも音読を継続して読む感覚を落とさないことを方針として整理した。",
      "本人は不安を抱えつつも、改善の手順が見えると前向きに動きやすい状態であり、次回までの行動が明確になると表情が和らいだ。",
      "",
      "■ 2. ポジティブな話題",
      "- 英語は音読を続けた日に読み直しが減っており、本人もやり方の手応えを感じている。",
      "- 改善の手順が明確になると、不安の中でも前向きに動ける土台がある。",
      "",
      "■ 3. 改善・対策が必要な話題",
      "- 数学は最初の一手が出ない場面を曖昧なままにしやすいため、止まった一題の思考メモを残して次回面談で原因を言語化する必要がある。",
      "- 英語は音読の継続が効果につながっているため、五日分の記録を残し、実行結果を次回面談で確認できる形にする必要がある。",
    ].join("\n"),
    timeline: [
      {
        title: "模試後の不安整理",
        what_happened: "模試の数学で最初の一手が出ずに止まる場面が共有された。",
        coach_point: "止まった瞬間を言葉で残し、次回面談の材料にするよう伝えた。",
        student_state: "不安は強いが、困りごとを言葉にすると落ち着いて整理できていた。",
        evidence_quotes: ["最初の一手が出ずに止まる問題があった。"],
      },
      {
        title: "英語学習の手応え確認",
        what_happened: "英語は音読を続けた日に読み直しが減る実感が共有された。",
        coach_point: "短時間でも継続し、止まらない感覚を優先すると整理した。",
        student_state: "効果を感じたやり方には前向きに取り組めそうだった。",
        evidence_quotes: ["音読を続けた日は読み直しが減る感覚がある。"],
      },
    ],
    nextActions: [
      {
        owner: "STUDENT",
        action: "数学で止まった一題を選び、最初の一手をメモする。",
        due: null,
        metric: "次回までに一題分の思考メモを残す。",
        why: "どこで止まったかを面談で振り返れるようにするため。",
      },
      {
        owner: "STUDENT",
        action: "英語の音読を五日続け、読み直し回数を減らす。",
        due: null,
        metric: "五日分の音読記録を残す。",
        why: "読む速度を落とさず意味を取る感覚を維持するため。",
      },
      {
        owner: "COACH",
        action: "次回面談で思考メモを見ながら止まった原因を一緒に整理する。",
        due: null,
        metric: "再現できた一手一つと、まだ出ない一手一つを確認する。",
        why: "数学で止まる場面のパターンを見つけるため。",
      },
    ],
    profileDelta: {
      basic: [
        {
          field: "学習状況",
          value: "数学は初手の整理が課題で、英語は音読の継続が手応えにつながっている。",
          confidence: 84,
          evidence_quotes: ["音読を続けた日は読み直しが減る感覚がある。"],
        },
      ],
      personal: [
        {
          field: "気持ちの動き",
          value: "不安はあるが、改善手順が見えると前向きに動きやすい。",
          confidence: 77,
          evidence_quotes: ["最初の一手が出ずに止まる問題があった。"],
        },
      ],
    },
    parentPack: {
      what_we_did: [
        "模試後の数学のつまずき方を振り返り、止まった瞬間の記録方法を整理しました。",
      ],
      what_improved: [
        "英語は音読を続けた日に読み直しが減るという手応えが見えています。",
      ],
      what_to_practice: [
        "数学は最初の一手をメモし、英語は音読を短時間でも継続してください。",
      ],
      risks_or_notes: [
        "数学は止まった原因が曖昧なままだと、同じ場面で再び手が止まりやすい状態です。",
      ],
      next_time_plan: [
        "次回面談では思考メモを見ながら、止まった場面と改善できた場面を整理します。",
      ],
      evidence_quotes: ["音読を続けた日は読み直しが減る感覚がある。"],
    },
    studentState: {
      label: "詰まり",
      oneLiner: "不安はあるが、改善手順が見えると前向きに動ける状態だった。",
      rationale: [
        "数学では止まった場面を言葉にしにくい一方、英語は手応えを具体的に話せていた。",
        "次回までの行動が整理されると表情が少し和らいだ。",
      ],
      confidence: 75,
    },
    recommendedTopics: [
      {
        category: "学習",
        title: "数学の最初の一手",
        reason: "どこで止まるかを具体化すると次回の打ち手を決めやすいため。",
        question: "止まった一題では最初に何を考えた？",
        priority: 1,
      },
      {
        category: "学習",
        title: "英語音読の継続感",
        reason: "手応えがある方法を安定して続けると学習の軸になりやすいため。",
        question: "音読を続けた日はどんな違いを感じた？",
        priority: 2,
      },
      {
        category: "生活",
        title: "勉強を始める時間帯",
        reason: "短時間でも続けやすい時間帯を決めると実行率が上がるため。",
        question: "勉強を始めやすい時間帯はいつ？",
        priority: 3,
      },
    ],
    quickQuestions: [
      {
        category: "学習",
        question: "思考メモは一題分残せた？",
        reason: "数学の振り返り材料があるかをすぐ確認するため。",
      },
      {
        category: "生活",
        question: "音読は何日続けられた？",
        reason: "英語学習の継続度を短時間で把握するため。",
      },
    ],
    profileSections: [
      {
        category: "学習",
        status: "改善",
        highlights: [
          {
            label: "英語の手応え",
            value: "音読を続けた日に読み直しが減る実感が出ている。",
            isNew: true,
            isUpdated: true,
          },
          {
            label: "数学の課題",
            value: "初手が出ない場面を記録して整理する必要がある。",
            isNew: true,
            isUpdated: false,
          },
        ],
        nextQuestion: "数学で止まる場面の共通点を次回もう少し詳しく確認したい。",
      },
      {
        category: "生活",
        status: "維持",
        highlights: [
          {
            label: "継続の土台",
            value: "短時間でも続けられるやり方があると前向きに動きやすい。",
            isNew: true,
            isUpdated: false,
          },
        ],
        nextQuestion: "無理なく続けやすい時間帯を次回確認したい。",
      },
    ],
    observationEvents: [
      {
        sourceType: "INTERVIEW",
        category: "学習",
        statusDraft: "改善",
        insights: [
          "英語は音読継続で読み直しが減る感覚が出ている。",
          "数学は最初の一手が出ない場面を記録して整理する必要がある。",
        ],
        topics: ["数学", "英語"],
        nextActions: [
          "数学で止まった一題の思考メモを残す。",
          "英語の音読を五日続ける。",
        ],
        evidence: [
          "最初の一手が出ずに止まる問題があった。",
          "音読を続けた日は読み直しが減る感覚がある。",
        ],
        characterSignal: "改善手順が見えると前向きに動ける。",
        weight: 4,
      },
    ],
    lessonReport: null,
  };
}

function installMockFetch() {
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const prompt = Array.isArray(body.messages)
      ? body.messages.map((message: { content?: string }) => String(message.content ?? "")).join("\n")
      : "";
    const mode = detectMode(prompt);
    const phase = detectPhase(prompt);
    requestLog.push({ phase, mode });

    const payload =
      phase === "analyze"
        ? buildChunkAnalysis(mode)
        : phase === "reduce"
          ? buildReduced(mode)
          : buildFinalizeResult(mode);

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: { content: JSON.stringify(payload) },
            finish_reason: "stop",
          },
        ],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  }) as typeof fetch;
}

async function main() {
  installMockFetch();

  const [{ buildSessionTranscript }, pipeline] = await Promise.all([
    import("../lib/session-service"),
    import("../lib/ai/conversationPipeline"),
  ]);

  const {
    analyzeChunkBlocks,
    reduceChunkAnalyses,
    finalizeConversationArtifacts,
    generateConversationArtifactsSinglePass,
  } = pipeline;

  const lessonTranscript = buildSessionTranscript(SessionType.LESSON_REPORT, [
    {
      id: "check-in",
      partType: SessionPartType.CHECK_IN,
      status: SessionPartStatus.READY,
      sourceType: ConversationSourceType.AUDIO,
      rawTextCleaned: "宿題の進みと今日扱いたいことを確認した。",
    },
    {
      id: "draft-full",
      partType: SessionPartType.FULL,
      status: SessionPartStatus.TRANSCRIBING,
      sourceType: ConversationSourceType.AUDIO,
      rawTextCleaned: "これは生成前なので入らない。",
    },
    {
      id: "check-out",
      partType: SessionPartType.CHECK_OUT,
      status: SessionPartStatus.READY,
      sourceType: ConversationSourceType.AUDIO,
      rawTextCleaned: "理解度と宿題、次回確認を整理した。",
    },
    {
      id: "note",
      partType: SessionPartType.TEXT_NOTE,
      status: SessionPartStatus.READY,
      sourceType: ConversationSourceType.MANUAL,
      rawTextCleaned: "補足メモも追記した。",
    },
  ]);

  assert.match(lessonTranscript, /## 授業前チェックイン/);
  assert.match(lessonTranscript, /## 授業後チェックアウト/);
  assert.match(lessonTranscript, /## 補足メモ/);
  assert.doesNotMatch(lessonTranscript, /## セッション構成/);
  assert.doesNotMatch(lessonTranscript, /これは生成前なので入らない。/);

  const interviewTranscript = buildSessionTranscript(SessionType.INTERVIEW, [
    {
      id: "full",
      partType: SessionPartType.FULL,
      status: SessionPartStatus.READY,
      sourceType: ConversationSourceType.AUDIO,
      rawTextCleaned: "模試後の不安と次回までの方針を確認した。",
    },
    {
      id: "note",
      partType: SessionPartType.TEXT_NOTE,
      status: SessionPartStatus.READY,
      sourceType: ConversationSourceType.MANUAL,
      rawTextCleaned: "生活面の補足も残した。",
    },
  ]);

  assert.doesNotMatch(interviewTranscript, /## セッション構成/);
  assert.match(interviewTranscript, /## 面談・通し録音/);

  const interviewBlocks = [
    {
      index: 0,
      hash: "interview-0",
      text: "模試の数学で最初の一手が出ずに止まる問題があり、英語は音読を続けた日に読み直しが減ると話した。",
    },
    {
      index: 1,
      hash: "interview-1",
      text: "次回までに数学の思考メモを一題分残し、英語の音読を五日続ける方針を確認した。",
    },
  ];

  const { analyses: interviewAnalyses } = await analyzeChunkBlocks(interviewBlocks, {
    studentName: "山田 太郎",
    teacherName: "佐藤",
    sessionType: "INTERVIEW",
  });
  const { reduced: interviewReduced } = await reduceChunkAnalyses({
    analyses: interviewAnalyses,
    studentName: "山田 太郎",
    teacherName: "佐藤",
    sessionType: "INTERVIEW",
  });
  const { result: interviewResult } = await finalizeConversationArtifacts({
    studentName: "山田 太郎",
    teacherName: "佐藤",
    reduced: interviewReduced,
    minSummaryChars: 120,
    minTimelineSections: 2,
    sessionType: "INTERVIEW",
  });

  assert.equal(interviewResult.lessonReport, null);
  assert.ok(interviewResult.summaryMarkdown.length >= 120);
  assert.ok(interviewResult.summaryMarkdown.includes("■ 1. サマリー"));
  assert.ok(interviewResult.timeline.length >= 2);
  assert.ok(interviewResult.nextActions.length >= 2);

  const lessonBlocks = [
    {
      index: 0,
      hash: "lesson-0",
      text: "授業前に英語長文の不安を確認し、授業後には根拠を言える場面が増えた。宿題では音読と根拠線引きを続けることにした。",
    },
    {
      index: 1,
      hash: "lesson-1",
      text: "次回授業では迷った設問を一題確認し、根拠位置と判断順を再現できるかを見ることにした。",
    },
  ];

  const { analyses: lessonAnalyses } = await analyzeChunkBlocks(lessonBlocks, {
    studentName: "田中 花",
    teacherName: "伊藤",
    sessionType: "LESSON_REPORT",
  });
  const { reduced: lessonReduced } = await reduceChunkAnalyses({
    analyses: lessonAnalyses,
    studentName: "田中 花",
    teacherName: "伊藤",
    sessionType: "LESSON_REPORT",
  });
  const { result: lessonResult } = await finalizeConversationArtifacts({
    studentName: "田中 花",
    teacherName: "伊藤",
    reduced: lessonReduced,
    minSummaryChars: 120,
    minTimelineSections: 2,
    sessionType: "LESSON_REPORT",
  });

  assert.ok(lessonResult.lessonReport);
  assert.ok((lessonResult.lessonReport?.todayGoal?.length ?? 0) > 0);
  assert.ok(lessonResult.summaryMarkdown.length >= 120);
  assert.ok(lessonResult.timeline.length >= 3);
  assert.ok(lessonResult.nextActions.length >= 3);

  const { result: interviewSinglePass } = await generateConversationArtifactsSinglePass({
    transcript: interviewTranscript,
    studentName: "山田 太郎",
    teacherName: "佐藤",
    minSummaryChars: 120,
    minTimelineSections: 2,
    sessionType: "INTERVIEW",
  });

  assert.equal(interviewSinglePass.lessonReport, null);
  assert.ok(interviewSinglePass.summaryMarkdown.includes("■ 1. サマリー"));
  assert.ok(interviewSinglePass.recommendedTopics.length >= 3);

  const { result: lessonSinglePass } = await generateConversationArtifactsSinglePass({
    transcript: lessonTranscript,
    studentName: "田中 花",
    teacherName: "伊藤",
    minSummaryChars: 120,
    minTimelineSections: 2,
    sessionType: "LESSON_REPORT",
  });

  assert.ok(lessonSinglePass.lessonReport);
  assert.ok(lessonSinglePass.lessonReport?.homework.length);
  assert.ok(lessonSinglePass.profileSections.length >= 2);

  assert.ok(requestLog.length >= 4);
  assert.ok(requestLog.some((item) => item.mode === "INTERVIEW"));
  assert.ok(requestLog.some((item) => item.mode === "LESSON_REPORT"));
  assert.ok(requestLog.some((item) => item.phase === "single-pass" && item.mode === "INTERVIEW"));
  assert.ok(requestLog.some((item) => item.phase === "single-pass" && item.mode === "LESSON_REPORT"));

  console.log("conversation mode smoke test passed");
  console.log(`requests: ${requestLog.length}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    globalThis.fetch = originalFetch;
  });
