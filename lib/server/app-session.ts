import { cache } from "react";
import { auth } from "@/auth";

export const getAppSession = cache(async () => auth());
