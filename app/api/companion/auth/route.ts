import { NextResponse } from "next/server";
import { openDatabase } from "@/lib/db";
import { authenticateUser } from "@/lib/auth-service";
import { signCompanionToken } from "@/lib/companion-token";

export const dynamic = "force-dynamic";

// 桌面伴侣登录：仅责任编辑可用，返回只读桌面令牌。
// 不返回密码哈希、AUTH_SECRET、公司内其他人员信息；不记录密码和令牌日志。
export async function POST(request: Request) {
  let username = "";
  let password = "";
  try {
    const body = await request.json();
    username = typeof body?.username === "string" ? body.username : "";
    password = typeof body?.password === "string" ? body.password : "";
  } catch {
    return NextResponse.json({ message: "请求格式错误" }, { status: 400 });
  }
  if (!username || !password) {
    return NextResponse.json({ message: "请输入用户名和密码" }, { status: 400 });
  }

  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return NextResponse.json({ message: "服务未配置密钥" }, { status: 500 });
  }

  const db = openDatabase();
  try {
    const user = authenticateUser(db, username, password);
    if (!user) {
      return NextResponse.json({ message: "账号或密码错误" }, { status: 401 });
    }
    if (user.must_change_password === 1) {
      return NextResponse.json({ message: "请先完成首次改密" }, { status: 403 });
    }
    if (user.role !== "RESPONSIBLE_EDITOR") {
      return NextResponse.json({ message: "无权限：仅责任编辑可使用桌面伴侣" }, { status: 403 });
    }
    const { token, expiresAt } = signCompanionToken(user.id, user.session_version, secret);
    return NextResponse.json({ token, expiresAt });
  } finally {
    db.close();
  }
}
