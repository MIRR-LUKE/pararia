function readEnvValue(name: string) {
  const value = process.env[name];
  if (typeof value !== "string") return "";
  return value.trim();
}

export function readFirstEnvValue(names: string[]) {
  for (const name of names) {
    const value = readEnvValue(name);
    if (value) return value;
  }
  return "";
}

export function requireEnvValue(names: string[], label?: string) {
  const value = readFirstEnvValue(names);
  if (value) return value;

  const joinedNames = names.join(" / ");
  throw new Error(`${label ?? joinedNames} が設定されていません。${joinedNames} を環境変数へ設定してください。`);
}

export function readConfiguredSecretValues(names: string[]) {
  return names
    .map((name) => ({ name, value: readEnvValue(name) }))
    .filter((entry) => entry.value.length > 0);
}
