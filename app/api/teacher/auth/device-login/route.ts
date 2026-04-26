import { NextResponse } from "next/server";

export async function POST(request: Request) {
  await request.json().catch(() => null);
  return NextResponse.json(
    {
      error: "Web 版 Teacher App の端末登録は終了しました。Android Teacher App から登録してください。",
    },
    { status: 410 }
  );
}
