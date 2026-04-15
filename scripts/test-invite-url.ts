#!/usr/bin/env tsx

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { buildInvitationAcceptUrl, resolvePublicAppBaseUrl } from "@/lib/invitations/invite-url";

async function main() {
  const previousNextauthUrl = process.env.NEXTAUTH_URL;
  const previousPublicAppUrl = process.env.NEXT_PUBLIC_APP_URL;

  try {
    process.env.NEXTAUTH_URL = "https://school.example.com/";
    process.env.NEXT_PUBLIC_APP_URL = "";

    const request = new Request("http://localhost:3000/api/invitations", {
      headers: {
        "x-forwarded-host": "evil.example",
        "x-forwarded-proto": "https",
      },
    });

    const baseUrl = resolvePublicAppBaseUrl(request);
    assert.equal(baseUrl, "https://school.example.com", "public base URL should come from configured URL");

    const inviteUrl = buildInvitationAcceptUrl(baseUrl, "plain token");
    assert.equal(
      inviteUrl,
      "https://school.example.com/invite/accept?token=plain%20token",
      "invite URL should be built from the public base URL"
    );

    process.env.NEXTAUTH_URL = "";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com/";
    const fallbackRequest = new Request("http://localhost:3000/api/invitations");
    assert.equal(
      resolvePublicAppBaseUrl(fallbackRequest),
      "https://app.example.com",
      "NEXT_PUBLIC_APP_URL should also work as public base URL"
    );

    console.log("invite url regression checks passed");
  } finally {
    if (previousNextauthUrl === undefined) {
      delete process.env.NEXTAUTH_URL;
    } else {
      process.env.NEXTAUTH_URL = previousNextauthUrl;
    }
    if (previousPublicAppUrl === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL;
    } else {
      process.env.NEXT_PUBLIC_APP_URL = previousPublicAppUrl;
    }
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
