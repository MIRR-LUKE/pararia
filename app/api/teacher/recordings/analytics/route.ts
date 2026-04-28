import { NextResponse } from "next/server";
import { requireAuthorizedSession } from "@/lib/server/request-auth";
import { getTeacherRecordingAnalyticsForOrganization } from "@/lib/teacher-app/server/recording-analytics";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseOptionalDate(searchParams: URLSearchParams, name: string) {
  const value = searchParams.get(name)?.trim();
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${name} は有効な日時で指定してください。`);
  }
  return date;
}

export async function GET(request: Request) {
  try {
    const authResult = await requireAuthorizedSession();
    if (authResult.response) return authResult.response;

    const { searchParams } = new URL(request.url);
    const analytics = await getTeacherRecordingAnalyticsForOrganization({
      organizationId: authResult.session.user.organizationId,
      period: {
        from: parseOptionalDate(searchParams, "from"),
        to: parseOptionalDate(searchParams, "to"),
      },
    });

    if (!analytics) {
      return NextResponse.json({ error: "organization not found" }, { status: 404 });
    }

    return NextResponse.json(
      { analytics },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  } catch (error: any) {
    const message = error?.message ?? "Internal Server Error";
    const status =
      message.includes("有効な日時") || message.includes("to より前") || message.includes("最大") ? 400 : 500;
    if (status >= 500) {
      console.error("[GET /api/teacher/recordings/analytics] Error:", error);
    }
    return NextResponse.json({ error: message }, { status });
  }
}
