import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

function assertIncludes(source: string, needle: string, message: string) {
  assert.ok(source.includes(needle), message);
}

function assertNotMatches(source: string, pattern: RegExp, message: string) {
  assert.equal(pattern.test(source), false, message);
}

const globals = read("app/globals.css");
const buttonTsx = read("components/ui/Button.tsx");
const buttonCss = read("components/ui/Button.module.css");
const sidebarTsx = read("components/layout/Sidebar.tsx");
const sidebarCss = read("components/layout/Sidebar.module.css");
const loginForm = read("app/login/LoginForm.tsx");
const renewalPlan = read("docs/ui-renewal-plan.md");

const implementationSources = [
  globals,
  buttonTsx,
  buttonCss,
  read("components/ui/Badge.module.css"),
  read("components/ui/Card.module.css"),
  read("components/ui/ConfirmDialog.module.css"),
  read("components/ui/StatePanel.module.css"),
  read("components/ui/Tabs.module.css"),
  read("components/ui/PageLoadingState.module.css"),
  sidebarTsx,
  sidebarCss,
  read("components/layout/AppHeader.module.css"),
  read("app/login/login.module.css"),
  read("app/app/dashboard/dashboard.module.css"),
].join("\n");

assertIncludes(globals, "color-scheme: light", "UI renewal must default to a light theme");
assertIncludes(globals, "[data-theme=\"dark\"]", "UI renewal must include dark theme overrides");
assertIncludes(globals, "--font-ja", "Japanese base font token must be defined");
assertIncludes(globals, "--font-en", "English font token must be defined");
assertIncludes(globals, "--surface-inverse", "Monochrome inverse surface token must exist for primary actions");
assertIncludes(globals, "--danger-soft", "Status soft tokens must exist for release states");

assertIncludes(buttonTsx, 'variant?: "primary" | "secondary" | "ghost" | "danger"', "Button must expose a destructive variant");
assertIncludes(buttonTsx, "loading?: boolean", "Button must expose a loading state");
assertIncludes(buttonCss, ".spinner", "Button loading state must render a spinner");

assertIncludes(sidebarTsx, "面談ログ", "Release sidebar must include Logs");
assertIncludes(sidebarTsx, "レポート", "Release sidebar must include Reports");
assertIncludes(sidebarTsx, "運用管理", "Release sidebar must include Operations entry");
assertIncludes(sidebarCss, "currentColor", "Sidebar icons must inherit state color");

assertIncludes(loginForm, 'htmlFor="login-email"', "Login email field must be explicitly labelled");
assertIncludes(loginForm, 'htmlFor="login-password"', "Login password field must be explicitly labelled");
assertIncludes(loginForm, "loading={submitting}", "Login submit button must use the shared loading state");

assertIncludes(renewalPlan, "現時点では新規UIライブラリは追加しない", "Dependency decision must be documented");
assertIncludes(renewalPlan, "Web録音導線は持たない", "UI plan must preserve native-only recording boundary");

assertNotMatches(
  implementationSources,
  /#693ac8|#8250ef|#dbff4b|rgba\(219,\s*255,\s*75|rgba\(105,\s*58,\s*200|radial-gradient|purple|lime/i,
  "Foundation implementation must not reintroduce old purple/lime decorative styling"
);

assertNotMatches(
  implementationSources,
  /font-size:\s*clamp\(|letter-spacing:\s*-/,
  "Foundation implementation must avoid viewport-scaled type and negative letter spacing"
);

console.log("ui renewal foundation regression checks passed");
