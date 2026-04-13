import { initializeRumServerConfig } from "@/lib/observability/rum";

export async function register() {
  initializeRumServerConfig();
}
