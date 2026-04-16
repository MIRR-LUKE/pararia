import { after } from "next/server";

type AfterResponseTask = () => void | Promise<void>;

export function runAfterResponse(task: AfterResponseTask, label: string) {
  const wrappedTask = async () => {
    try {
      await task();
    } catch (error) {
      console.error(`[${label}] after-response task failed:`, error);
    }
  };

  try {
    after(wrappedTask);
    return;
  } catch {
    void wrappedTask();
  }
}
