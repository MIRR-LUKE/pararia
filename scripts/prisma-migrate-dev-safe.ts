import { assertPrismaMigrateDevTargetSafe } from "./lib/environment-safety";
import { loadLocalEnvFiles } from "./lib/load-local-env";

await loadLocalEnvFiles();
assertPrismaMigrateDevTargetSafe("prisma-migrate-dev");

console.log("prisma migrate dev target is local");
