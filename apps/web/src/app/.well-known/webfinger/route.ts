import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      error: "not_implemented",
      message: "WebFinger is reserved for future federation support.",
    },
    {
      status: 501,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    },
  );
}
