import type Database from "better-sqlite3";
import { TaskServiceError } from "./task-service.ts";
import { toShanghaiYMD, shanghaiDayStartMs } from "./date-util.ts";

// ===== 送达（配送）业务服务 =====
// 送达是独立于 tasks.status 的追加事实（deliveries 表），不改变任务状态、不影响既有统计。
// 权限、公司归属、送达时间全部以服务端为准，绝不信任浏览器传值。

const DAY_MS = 86400000;

function now(): string {
  return new Date().toISOString();
}

interface UserRow {
  id: number;
  role: string;
  company_id: number | null;
  is_active: number;
  must_change_password: number;
}

function getActiveUser(db: Database.Database, userId: number): UserRow {
  const user = db
    .prepare(
      "SELECT id, role, company_id, is_active, must_change_password FROM users WHERE id = ?",
    )
    .get(userId) as UserRow | undefined;
  if (!user) throw new TaskServiceError("USER_NOT_FOUND", "用户不存在");
  if (user.is_active !== 1)
    throw new TaskServiceError("USER_INACTIVE", "用户已停用");
  if (user.must_change_password === 1)
    throw new TaskServiceError("MUST_CHANGE_PASSWORD", "请先完成首次改密");
  return user;
}

// 最近 7 个上海自然日的展示窗口起点：今天（东八区）00:00 往前推 6 个自然日。
// 例：8月1日送达 → 8月1日至8月7日显示；8月8日起窗口起点移到8月2日，8月1日不再显示。
export function recentDeliveryCutoffMs(nowDate: Date): number {
  const ymd = toShanghaiYMD(nowDate);
  return shanghaiDayStartMs(ymd.year, ymd.month, ymd.day) - 6 * DAY_MS;
}

export type DeliverResult = "delivered" | "already_delivered";

export interface DeliverOptions {
  proxyReason?: string; // Dominance 代送达原因
}

// 送达：外校主管送达本公司任务；Dominance 代送达（须填原因、不得改换接收公司）。
// 只能送达 status='COMPLETED' 的任务；deliveries.task_id UNIQUE + 原子插入保证不产生第二条记录。
export function deliverTask(
  db: Database.Database,
  taskId: number,
  operatorId: number,
  opts: DeliverOptions = {},
): DeliverResult {
  const operator = getActiveUser(db, operatorId);
  if (operator.role !== "EXTERNAL_SUPERVISOR" && operator.role !== "INTERNAL_ADMIN") {
    throw new TaskServiceError("FORBIDDEN", "无权限：仅外校主管或 Dominance 可送达");
  }

  const task = db
    .prepare("SELECT id, status, company_id FROM tasks WHERE id = ?")
    .get(taskId) as { id: number; status: string; company_id: number | null } | undefined;
  if (!task) throw new TaskServiceError("TASK_NOT_FOUND", "任务不存在");
  if (task.status !== "COMPLETED") {
    throw new TaskServiceError("INVALID_STATUS", "仅已结束校对的任务可送达");
  }

  let isProxy = false;
  let proxyReason = "";
  if (operator.role === "EXTERNAL_SUPERVISOR") {
    if (operator.company_id == null)
      throw new TaskServiceError("FORBIDDEN", "外校主管未关联公司");
    if (task.company_id !== operator.company_id)
      throw new TaskServiceError("FORBIDDEN", "不能送达其他外校公司的任务");
  } else {
    proxyReason = (opts.proxyReason ?? "").trim();
    if (!proxyReason)
      throw new TaskServiceError("PROXY_REASON_REQUIRED", "代操作需填写原因");
    if (proxyReason.length > 200)
      throw new TaskServiceError("INVALID_INPUT", "代操作原因最多 200 字");
    if (task.company_id == null)
      throw new TaskServiceError("INVALID_STATUS", "该任务未指定接收外校公司");
    isProxy = true;
  }

  const deliveredAt = now();

  return db.transaction(() => {
    // 原子插入 + 幂等：已存在则视为已送达，不重复写入、不重复写审计。
    const info = db
      .prepare(
        `INSERT INTO deliveries(task_id, delivered_by, is_proxy, proxy_role, proxy_reason, delivered_at)
         SELECT ?, ?, ?, ?, ?, ?
         WHERE NOT EXISTS (SELECT 1 FROM deliveries WHERE task_id = ?)`,
      )
      .run(
        taskId,
        operator.id,
        isProxy ? 1 : 0,
        isProxy ? "EXTERNAL_SUPERVISOR" : null,
        proxyReason || null,
        deliveredAt,
        taskId,
      );
    if (info.changes === 0) return "already_delivered";

    if (isProxy) {
      // 代送达审计：沿用项目既有代操作审计模式（operation_type=PROXY_DELIVER）。
      db.prepare(
        "INSERT INTO audit_log(operator_id, operation_type, target_type, target_id, reason, before_value, after_value, proxy_role, occurred_at) VALUES (?,?,?,?,?,?,?,?,?)",
      ).run(
        operator.id,
        "PROXY_DELIVER",
        "task",
        String(taskId),
        proxyReason,
        null,
        JSON.stringify({ deliveredAt }),
        "EXTERNAL_SUPERVISOR",
        deliveredAt,
      );
    }
    return "delivered";
  })();
}

// ===== 确认收到 =====

export type DeliveryReceiptResult = "confirmed" | "already_confirmed";

// 责任编辑本人确认收到：须先有 deliveries 记录；仅本书责任编辑可确认；
// delivery_receipts.delivery_id UNIQUE + 原子插入保证并发/重复点击不产生第二条记录。
export function confirmDeliveryReceipt(
  db: Database.Database,
  taskId: number,
  operatorId: number,
): DeliveryReceiptResult {
  const operator = getActiveUser(db, operatorId);
  if (operator.role !== "RESPONSIBLE_EDITOR") {
    throw new TaskServiceError("FORBIDDEN", "无权限：仅责任编辑可确认收到");
  }

  const delivery = db
    .prepare("SELECT id FROM deliveries WHERE task_id = ?")
    .get(taskId) as { id: number } | undefined;
  if (!delivery) {
    throw new TaskServiceError("INVALID_STATUS", "该任务尚无送达记录，无法确认");
  }

  const book = db
    .prepare(
      "SELECT b.editor_id FROM tasks t JOIN books b ON b.id = t.book_id WHERE t.id = ?",
    )
    .get(taskId) as { editor_id: number | null } | undefined;
  if (!book || book.editor_id !== operator.id) {
    throw new TaskServiceError("FORBIDDEN", "只能确认自己书稿的稿件");
  }

  const confirmedAt = now();

  return db.transaction(() => {
    const info = db
      .prepare(
        "INSERT INTO delivery_receipts(delivery_id, confirmed_by, confirmed_at) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM delivery_receipts WHERE delivery_id = ?)",
      )
      .run(delivery.id, operator.id, confirmedAt, delivery.id);
    if (info.changes === 0) return "already_confirmed";
    return "confirmed";
  })();
}
