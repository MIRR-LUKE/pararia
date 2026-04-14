export type RoutePerformanceState = "empty" | "loading" | "populated";

export type RoutePerformanceBudget = {
  targetMs: number;
  hardMs: number;
};

export type RoutePerformanceScenarioResult = {
  id: string;
  label: string;
  route: string;
  state: RoutePerformanceState;
  loadingShellMs: number | null;
  readyMs: number;
  interactionMs: number | null;
  budget: RoutePerformanceBudget;
  budgetStatus: "ok" | "warn" | "fail";
  baselineMs: number | null;
  deltaMs: number | null;
  deltaPct: number | null;
  note?: string | null;
};

export type RoutePerformanceRun = {
  label: string;
  baseUrl: string;
  generatedAt: string;
  loginPageMs: number;
  authApiMs: number;
  dashboardMs: number;
  consoleErrors: string[];
  scenarios: RoutePerformanceScenarioResult[];
};

export type RoutePerformanceComparison = {
  baselinePath: string;
  baselineGeneratedAt: string | null;
  rows: Array<{
    id: string;
    label: string;
    state: RoutePerformanceState;
    route: string;
    currentMs: number;
    baselineMs: number | null;
    deltaMs: number | null;
    deltaPct: number | null;
    budgetTargetMs: number;
    budgetHardMs: number;
    budgetStatus: "ok" | "warn" | "fail";
  }>;
  overTargetCount: number;
  hardViolationCount: number;
};

export const ROUTE_PERFORMANCE_BUDGETS: Record<string, RoutePerformanceBudget> = {
  dashboard: { targetMs: 700, hardMs: 1000 },
  students: { targetMs: 450, hardMs: 700 },
  studentsEmptySearch: { targetMs: 400, hardMs: 650 },
  logs: { targetMs: 450, hardMs: 700 },
  logsEmpty: { targetMs: 450, hardMs: 800 },
  reports: { targetMs: 650, hardMs: 900 },
  reportsEmpty: { targetMs: 500, hardMs: 850 },
};

export function formatMs(value: number | null | undefined) {
  if (value === null || value === undefined) return "n/a";
  return `${Math.round(value)}ms`;
}

export function formatDelta(value: number | null | undefined) {
  if (value === null || value === undefined) return "n/a";
  const sign = value > 0 ? "+" : "";
  return `${sign}${Math.round(value)}ms`;
}

export function formatDeltaPct(value: number | null | undefined) {
  if (value === null || value === undefined) return "n/a";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export function getBudgetStatus(value: number, budget: RoutePerformanceBudget) {
  if (value > budget.hardMs) return "fail" as const;
  if (value > budget.targetMs) return "warn" as const;
  return "ok" as const;
}

export function summarizeComparison(current: RoutePerformanceRun, baseline?: RoutePerformanceRun | null): RoutePerformanceComparison | null {
  if (!baseline) return null;
  const baselineById = new Map(baseline.scenarios.map((scenario) => [scenario.id, scenario]));
  const rows = current.scenarios.map((scenario) => {
    const baselineScenario = baselineById.get(scenario.id) ?? null;
    return {
      id: scenario.id,
      label: scenario.label,
      state: scenario.state,
      route: scenario.route,
      currentMs: scenario.readyMs,
      baselineMs: baselineScenario?.readyMs ?? null,
      deltaMs:
        baselineScenario && Number.isFinite(baselineScenario.readyMs)
          ? scenario.readyMs - baselineScenario.readyMs
          : null,
      deltaPct:
        baselineScenario && baselineScenario.readyMs > 0
          ? ((scenario.readyMs - baselineScenario.readyMs) / baselineScenario.readyMs) * 100
          : null,
      budgetTargetMs: scenario.budget.targetMs,
      budgetHardMs: scenario.budget.hardMs,
      budgetStatus: scenario.budgetStatus,
    };
  });

  return {
    baselinePath: "",
    baselineGeneratedAt: baseline.generatedAt,
    rows,
    overTargetCount: rows.filter((row) => row.currentMs > row.budgetTargetMs).length,
    hardViolationCount: rows.filter((row) => row.currentMs > row.budgetHardMs).length,
  };
}

function renderScenarioRows(run: RoutePerformanceRun, comparison: RoutePerformanceComparison | null) {
  return run.scenarios
    .map((scenario) => {
      const compared = comparison?.rows.find((row) => row.id === scenario.id) ?? null;
      const delta = compared?.deltaMs ?? scenario.deltaMs;
      const deltaPct = compared?.deltaPct ?? scenario.deltaPct;
      return [
        `| ${scenario.label} | ${scenario.route} | ${scenario.state} | ${formatMs(scenario.loadingShellMs)} | ${formatMs(scenario.readyMs)} | ${formatMs(scenario.interactionMs)} | ${formatMs(scenario.budget.targetMs)} / ${formatMs(scenario.budget.hardMs)} | ${formatMs(compared?.baselineMs ?? scenario.baselineMs)} | ${formatDelta(delta)} / ${formatDeltaPct(deltaPct)} | ${scenario.budgetStatus} |`,
      ];
    })
    .flat();
}

export function renderRoutePerformanceReport(run: RoutePerformanceRun, comparison: RoutePerformanceComparison | null = null) {
  const targetOverages = run.scenarios.filter((scenario) => scenario.readyMs > scenario.budget.targetMs);
  const hardViolations = run.scenarios.filter((scenario) => scenario.readyMs > scenario.budget.hardMs);

  return [
    `# route performance report (${run.label})`,
    "",
    "## summary",
    `- generated at: ${run.generatedAt}`,
    `- base url: ${run.baseUrl}`,
    `- login page: ${formatMs(run.loginPageMs)}`,
    `- auth api: ${formatMs(run.authApiMs)}`,
    `- dashboard ready: ${formatMs(run.dashboardMs)}`,
    `- console errors: ${run.consoleErrors.length}`,
    `- over target budget: ${targetOverages.length}`,
    `- hard violations: ${hardViolations.length}`,
    comparison ? `- baseline: ${comparison.baselineGeneratedAt ?? "unknown"} (${comparison.baselinePath || "unknown path"})` : "- baseline: not provided",
    "",
    "## scenarios",
    "| scenario | route | state | loading shell | ready | interaction | budget | baseline | delta | status |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...renderScenarioRows(run, comparison),
    "",
    "## console errors",
    run.consoleErrors.length > 0 ? run.consoleErrors.map((line) => `- ${line}`) : ["- none"],
    "",
  ].join("\n");
}
