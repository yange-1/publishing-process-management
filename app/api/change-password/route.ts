import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { changePassword } from "@/lib/auth-service";
import { openDatabase } from "@/lib/db";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ message: "未登录" }, { status: 401 });
  }

  let newPassword = "";
  let confirmPassword = "";
  try {
    const body = await request.json();
    newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";
    confirmPassword = typeof body?.confirmPassword === "string" ? body.confirmPassword : "";
  } catch {
    return NextResponse.json({ message: "请求格式错误" }, { status: 400 });
  }

  const db = openDatabase();
  try {
    const result = changePassword(db, Number(session.user.id), newPassword, confirmPassword);
    if (!result.ok) {
      return NextResponse.json({ message: result.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } finally {
    db.close();
  }
}
