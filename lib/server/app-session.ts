import { cache } from "react";
import { auth } from "@/auth";
import { resolveAuthorizedSession } from "@/lib/server/request-auth";

export const getAppSession = cache(async () => resolveAuthorizedSession(await auth()));
