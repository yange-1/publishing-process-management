import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getSessionUser, type AuthUser } from "@/lib/auth-service";
import { openDatabase } from "@/lib/db";
import { verifyCompanionToken } from "@/lib/companion-token";
import { listCompanionManuscripts } from "@/lib/companion-service";

export const dynamic = "force-dynamic";

// 同时支持：1) 浏览器 NextAuth 会话；2) Electron 通过 Authorization: Bearer <token> 访问。
async function resolveCompanionUser(request: Request): Promise<AuthUser | null> {
  const authHeader = request.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const secret = process.env.AUTH_SECRET;
    if (!secret) return null;
    const token = authHeader.slice(7).trim();
    const payload = verifyCompanionToken(token, secret);
    if (!payload) return null;
    // 回查 sessionVersion：密码/会话改变后旧令牌失效。
    const db = openDatabase();
    try {
      return getSessionUser(db, payload.userId, payload.sessionVersion);
    } finally {
      db.close();
    }
  }
  return getCurrentUser();
}

// 桌面伴侣只读接口：返回当前责任编辑本人的书稿状态列表。
// 仅 GET；editorId 从服务器会话/令牌取得，不接受客户端传入。
export async function GET(request: Request) {
  const user = await resolveCompanionUser(request);
  if (!user) {
    return NextResponse.json({ message: "未登录或会话已失效" }, { status: 401 });
  }
  if (user.must_change_password === 1) {
    return NextResponse.json({ message: "请先完成首次改密" }, { status: 403 });
  }
  if (user.role !== "RESPONSIBLE_EDITOR") {
    return NextResponse.json({ message: "无权限" }, { status: 403 });
  }

  const db = openDatabase();
  try {
    const manuscripts = listCompanionManuscripts(db, user.id, new Date());
    return NextResponse.json(
      { serverTime: new Date().toISOString(), manuscripts },
      { headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    db.close();
  }
}
