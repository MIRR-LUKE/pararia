export async function runScriptStep<T>(scope: string, name: string, work: () => Promise<T>) {
  console.log(`[${scope}] ${name}: start`);
  try {
    const result = await work();
    console.log(`[${scope}] ${name}: ok`);
    return result;
  } catch (error) {
    console.error(`[${scope}] ${name}: failed`, error);
    throw error;
  }
}
