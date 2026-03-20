import { createHash, randomBytes } from "crypto";

export function generateInvitationPlainToken() {
  return randomBytes(32).toString("base64url");
}

export function hashInvitationToken(plain: string) {
  return createHash("sha256").update(plain, "utf8").digest("hex");
}
