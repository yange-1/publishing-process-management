import type Database from "better-sqlite3";

// ===== 业务错误 =====

export type TaskErrorCode =
  | "USER_NOT_FOUND"
  | "USER_INACTIVE"
  | "MUST_CHANGE_PASSWORD"
  | "FORBIDDEN"
  | "TASK_NOT_FOUND"
  | "INVALID_STATUS"
  | "TASK_ALREADY_STARTED"
  | "PROOFREADER_BUSY"
  | "NOT_TASK_PROOFREADER"
  | "PROXY_REASON_REQUIRED"
  | "INVALID_STAGE_OR_STAR"
  | "INVALID_INPUT"
  | "INVALID_COMPANY"
  | "BOOK_HAS_ACTIVE_TASK"
  | "NO_COMPLETED_STAGE"
  | "MAX_STAGE_REACHED";

export class TaskServiceError extends Error {
  readonly code: TaskErrorCode;
  constructor(code: TaskErrorCode, message: string) {
    super(message);
    this.name = "TaskServiceError";
    this.code = code;
  }
}

// 将任意错误转换为可安全展示给用户的中文提示，绝不泄露 SQLite 原始错误。
export function taskErrorMessage(err: unknown): string {
  if (err instanceof TaskServiceError) return err.message;
  return "操作失败，请稍后重试";
}

// ===== 常量 =====

export const STAGES = [
  "INITIAL_REVIEW",
  "FIRST_PROOF",
  "SECOND_PROOF",
  "THIRD_PROOF",
  "ADDITIONAL_PROOF",
] as const;

// 本次工作内容：读校 / 核红 / 读校且核红
export const WORK_TYPES = ["PROOFREAD", "RED_CHECK", "PROOFREAD_AND_RED_CHECK"] as const;
export type WorkType = (typeof WORK_TYPES)[number];
export const DEFAULT_WORK_TYPE: WorkType = "PROOFREAD";

// 校次顺序中的下一校次；加校完成后可继续发起加校。
export function nextStage(stage: string): string | null {
  const idx = (STAGES as readonly string[]).indexOf(stage);
  if (idx < 0) return null;
  if (idx === STAGES.length - 1) return stage; // 加校可重复
  return STAGES[idx + 1];
}

const EVENT_PUBLISHED = "TASK_PUBLISHED";
const EVENT_CONFIRMED = "RECEIPT_CONFIRMED";
const EVENT_STARTED = "TASK_STARTED";
const EVENT_COMPLETED = "TASK_COMPLETED";
const EVENT_CANCELLED = "TASK_CANCELLED";

// ===== 内部工具 =====

interface UserRow {
  id: number;
  role: string;
  company_id: number | null;
  is_active: number;
  must_change_password: number;
}

interface TaskRow {
  id: number;
  status: string;
  proofreader_id: number | null;
}

function now(): string {
  return new Date().toISOString();
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

function getTask(db: Database.Database, taskId: number): TaskRow {
  const task = db
    .prepare("SELECT id, status, proofreader_id FROM tasks WHERE id = ?")
    .get(taskId) as TaskRow | undefined;
  if (!task) throw new TaskServiceError("TASK_NOT_FOUND", "任务不存在");
  return task;
}

function assertStage(stage: string): void {
  if (!(STAGES as readonly string[]).includes(stage)) {
    throw new TaskServiceError("INVALID_STAGE_OR_STAR", "无效校次");
  }
}

function assertStar(star: number): void {
  if (!Number.isInteger(star) || star < 1 || star > 3) {
    throw new TaskServiceError("INVALID_STAGE_OR_STAR", "无效星级（应为 1-3）");
  }
}

function assertWorkType(workType: string | undefined): WorkType {
  const wt = workType ?? DEFAULT_WORK_TYPE;
  if (!(WORK_TYPES as readonly string[]).includes(wt)) {
    throw new TaskServiceError("INVALID_INPUT", "无效的工作内容");
  }
  return wt as WorkType;
}

function insertEvent(
  db: Database.Database,
  taskId: number,
  eventType: string,
  operator: UserRow,
  isProxy: boolean,
  proxyRole: string | null,
  statusFrom: string | null,
  statusTo: string,
): void {
  db.prepare(
    "INSERT INTO task_events(task_id, event_type, operator_id, operator_role, is_proxy, proxy_role, status_from, status_to, occurred_at) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(
    taskId,
    eventType,
    operator.id,
    operator.role,
    isProxy ? 1 : 0,
    proxyRole,
    statusFrom,
    statusTo,
    now(),
  );
}

function insertAudit(
  db: Database.Database,
  operatorId: number,
  operationType: string,
  targetId: number,
  reason: string,
  beforeValue: string | null,
  afterValue: string | null,
  proxyRole: string | null,
): void {
  db.prepare(
    "INSERT INTO audit_log(operator_id, operation_type, target_type, target_id, reason, before_value, after_value, proxy_role, occurred_at) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(
    operatorId,
    operationType,
    "task",
    String(targetId),
    reason,
    beforeValue,
    afterValue,
    proxyRole,
    now(),
  );
}

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string };
  return typeof err?.code === "string" && err.code.startsWith("SQLITE_CONSTRAINT");
}

// ===== 1. 发布校对任务 =====

export interface PublishParams {
  operatorId: number;
  bookId?: number;
  bookTitle?: string;
  identifier?: string;
  stage: string;
  starLevel: number;
  workType?: string; // 本次工作内容：读校/核红/读校且核红
  note?: string;
  companyId?: number; // 接收外校公司
  editorId?: number; // 代发时指定目标责任编辑
  proxyReason?: string; // 代发原因
}

export function publishTask(db: Database.Database, params: PublishParams): number {
  const operator = getActiveUser(db, params.operatorId);
  if (operator.role !== "RESPONSIBLE_EDITOR" && operator.role !== "INTERNAL_ADMIN") {
    throw new TaskServiceError("FORBIDDEN", "无权限：仅责任编辑或超级管理员可发布");
  }
  assertStar(params.starLevel);

  const workType = assertWorkType(params.workType);

  // 备注：可选，最多 200 字
  const note = (params.note ?? "").trim();
  if (note.length > 200)
    throw new TaskServiceError("INVALID_INPUT", "备注最多 200 字");

  // 接收外校公司：真实存在、启用且类型为 EXTERNAL
  if (params.companyId != null) {
    const company = db
      .prepare(
        "SELECT id FROM companies WHERE id = ? AND type = 'EXTERNAL' AND is_active = 1",
      )
      .get(params.companyId);
    if (!company)
      throw new TaskServiceError("INVALID_COMPANY", "接收外校公司不存在、已停用或不是外校公司");
  }

  let editorId: number;
  let isProxy = false;
  let proxyReason = "";
  if (operator.role === "RESPONSIBLE_EDITOR") {
    editorId = operator.id;
  } else {
    proxyReason = (params.proxyReason ?? "").trim();
    if (!proxyReason)
      throw new TaskServiceError("PROXY_REASON_REQUIRED", "代操作需填写原因");
    if (proxyReason.length > 200)
      throw new TaskServiceError("INVALID_INPUT", "代发布原因最多 200 字");

    // 已有书稿：责任编辑由书稿的 editor_id 自动确定，不允许改挂到其他责任编辑
    let targetEditorId: number | null | undefined = params.editorId;
    if (params.bookId != null) {
      const book = db
        .prepare("SELECT editor_id FROM books WHERE id = ?")
        .get(params.bookId) as { editor_id: number | null } | undefined;
      if (!book) throw new TaskServiceError("TASK_NOT_FOUND", "指定的书稿不存在");
      targetEditorId = book.editor_id;
    }
    if (targetEditorId == null)
      throw new TaskServiceError("PROXY_REASON_REQUIRED", "代发布需指定目标责任编辑");

    const editor = db
      .prepare(
        "SELECT id FROM users WHERE id = ? AND role = 'RESPONSIBLE_EDITOR' AND is_active = 1",
      )
      .get(targetEditorId);
    if (!editor)
      throw new TaskServiceError("USER_NOT_FOUND", "目标责任编辑不存在或不可用");
    editorId = targetEditorId;
    isProxy = true;
  }

  const publishedAt = now();

  return db.transaction(() => {
    let bookId = params.bookId;
    let stage: string;
    if (!bookId) {
      assertStage(params.stage);
      const title = (params.bookTitle ?? "").trim();
      if (!title) throw new TaskServiceError("INVALID_INPUT", "书名不能为空");
      const bookResult = db
        .prepare("INSERT INTO books(title, editor_id, identifier) VALUES (?,?,?)")
        .run(title, editorId, params.identifier ?? null);
      bookId = Number(bookResult.lastInsertRowid);
      stage = params.stage;
    } else {
      const book = db
        .prepare("SELECT id, editor_id FROM books WHERE id = ?")
        .get(bookId) as { id: number; editor_id: number | null } | undefined;
      if (!book) throw new TaskServiceError("TASK_NOT_FOUND", "指定的书稿不存在");
      // 普通责任编辑只能继续发起属于自己的书稿
      if (!isProxy && book.editor_id !== editorId)
        throw new TaskServiceError("FORBIDDEN", "无权使用该书稿");
      // 下一校次由系统自动计算，不接受浏览器传入的校次
      stage = resolveNextStage(db, bookId);
    }

    const taskResult = db
      .prepare(
        "INSERT INTO tasks(book_id, stage, work_type, star_level, status, note, publisher_id, published_at, company_id) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .run(
        bookId,
        stage,
        workType,
        params.starLevel,
        "PENDING_CONFIRMATION",
        note || null,
        editorId,
        publishedAt,
        params.companyId ?? null,
      );
    const taskId = Number(taskResult.lastInsertRowid);

    insertEvent(db, taskId, EVENT_PUBLISHED, operator, isProxy, isProxy ? "RESPONSIBLE_EDITOR" : null, null, "PENDING_CONFIRMATION");
    if (isProxy) {
      insertAudit(
        db,
        operator.id,
        "PROXY_PUBLISH",
        taskId,
        proxyReason,
        null,
        JSON.stringify({ bookId, stage, workType, starLevel: params.starLevel, editorId, companyId: params.companyId ?? null }),
        "RESPONSIBLE_EDITOR",
      );
    }
    return taskId;
  })();
}

// ===== 2. 确认收稿 =====

export interface ConfirmOptions {
  proxyReason?: string; // 管理员代确认时填写
}

export type ConfirmResult = "confirmed" | "already_confirmed";

export function confirmReceipt(
  db: Database.Database,
  taskId: number,
  operatorId: number,
  opts: ConfirmOptions = {},
): ConfirmResult {
  const operator = getActiveUser(db, operatorId);
  if (operator.role !== "EXTERNAL_SUPERVISOR" && operator.role !== "INTERNAL_ADMIN") {
    throw new TaskServiceError("FORBIDDEN", "无权限：仅外校主管或超级管理员可确认");
  }

  const task = db
    .prepare("SELECT id, status, company_id FROM tasks WHERE id = ?")
    .get(taskId) as { id: number; status: string; company_id: number | null } | undefined;
  if (!task) throw new TaskServiceError("TASK_NOT_FOUND", "任务不存在");

  let companyId: number | null;
  let isProxy = false;
  let proxyReason = "";
  if (operator.role === "EXTERNAL_SUPERVISOR") {
    if (operator.company_id == null)
      throw new TaskServiceError("FORBIDDEN", "外校主管未关联公司");
    if (task.company_id !== operator.company_id)
      throw new TaskServiceError("FORBIDDEN", "不能确认其他外校公司的任务");
    companyId = operator.company_id;
  } else {
    proxyReason = (opts.proxyReason ?? "").trim();
    if (!proxyReason)
      throw new TaskServiceError("PROXY_REASON_REQUIRED", "代操作需填写原因");
    if (proxyReason.length > 200)
      throw new TaskServiceError("INVALID_INPUT", "代确认原因最多 200 字");
    if (task.company_id == null)
      throw new TaskServiceError("INVALID_STATUS", "该任务未指定接收外校公司");
    companyId = task.company_id; // 代确认目标公司 = 任务已有 company_id，不允许改换
    isProxy = true;
  }

  const confirmedAt = now();

  return db.transaction(() => {
    const info = db
      .prepare(
        "UPDATE tasks SET status='READY_TO_START', confirmer_id=?, confirm_company_id=?, confirmed_at=? WHERE id=? AND status='PENDING_CONFIRMATION'",
      )
      .run(operator.id, companyId, confirmedAt, taskId);

    if (info.changes === 0) {
      const current = getTask(db, taskId);
      if (current.status === "CANCELLED")
        throw new TaskServiceError("INVALID_STATUS", "已取消任务不能确认");
      if (current.status === "IN_PROGRESS" || current.status === "COMPLETED")
        throw new TaskServiceError("INVALID_STATUS", "当前状态不允许确认收稿");
      return "already_confirmed"; // READY_TO_START：已被确认，无需重复操作
    }

    insertEvent(db, taskId, EVENT_CONFIRMED, operator, isProxy, isProxy ? "EXTERNAL_SUPERVISOR" : null, "PENDING_CONFIRMATION", "READY_TO_START");
    if (isProxy) {
      insertAudit(
        db,
        operator.id,
        "PROXY_CONFIRM",
        taskId,
        proxyReason,
        JSON.stringify({ status: "PENDING_CONFIRMATION" }),
        JSON.stringify({ status: "READY_TO_START", companyId }),
        "EXTERNAL_SUPERVISOR",
      );
    }
    return "confirmed";
  })();
}

// ===== 3. 开始校对 =====

export interface StartOptions {
  proofreaderId?: number; // 代开始时指定目标校对人员
  proxyReason?: string;
}

export function startTask(
  db: Database.Database,
  taskId: number,
  operatorId: number,
  opts: StartOptions = {},
): void {
  const operator = getActiveUser(db, operatorId);
  if (operator.role !== "PROOFREADER" && operator.role !== "INTERNAL_ADMIN") {
    throw new TaskServiceError("FORBIDDEN", "无权限：仅校对人员或超级管理员可开始");
  }

  const task = db
    .prepare("SELECT id, status, company_id FROM tasks WHERE id = ?")
    .get(taskId) as { id: number; status: string; company_id: number | null } | undefined;
  if (!task) throw new TaskServiceError("TASK_NOT_FOUND", "任务不存在");

  let proofreaderId: number;
  let isProxy = false;
  let proxyReason = "";
  if (operator.role === "PROOFREADER") {
    if (operator.company_id == null)
      throw new TaskServiceError("FORBIDDEN", "校对人员未关联公司");
    if (task.company_id !== operator.company_id)
      throw new TaskServiceError("FORBIDDEN", "不能开始其他外校公司的任务");
    proofreaderId = operator.id;
  } else {
    proxyReason = (opts.proxyReason ?? "").trim();
    if (!opts.proofreaderId)
      throw new TaskServiceError("PROXY_REASON_REQUIRED", "代开始需指定目标校对人员");
    if (!proxyReason)
      throw new TaskServiceError("PROXY_REASON_REQUIRED", "代操作需填写原因");
    if (proxyReason.length > 200)
      throw new TaskServiceError("INVALID_INPUT", "代操作原因最多 200 字");
    // 目标校对人员必须启用、角色正确、且与任务接收外校公司相同
    const proofreader = db
      .prepare(
        "SELECT id FROM users WHERE id = ? AND role = 'PROOFREADER' AND is_active = 1 AND company_id = ?",
      )
      .get(opts.proofreaderId, task.company_id);
    if (!proofreader)
      throw new TaskServiceError("USER_NOT_FOUND", "目标校对人员不存在、已停用或所属公司不匹配");
    proofreaderId = opts.proofreaderId;
    isProxy = true;
  }

  const startedAt = now();

  try {
    db.transaction(() => {
      const info = db
        .prepare(
          "UPDATE tasks SET status='IN_PROGRESS', proofreader_id=?, started_at=? WHERE id=? AND status='READY_TO_START'",
        )
        .run(proofreaderId, startedAt, taskId);

      if (info.changes === 0) {
        const current = getTask(db, taskId);
        if (current.status === "IN_PROGRESS")
          throw new TaskServiceError("TASK_ALREADY_STARTED", "该任务已被领取");
        if (current.status === "CANCELLED")
          throw new TaskServiceError("INVALID_STATUS", "已取消任务不能开始");
        throw new TaskServiceError("INVALID_STATUS", "当前状态不允许开始（需先确认收稿）");
      }

      insertEvent(db, taskId, EVENT_STARTED, operator, isProxy, isProxy ? "PROOFREADER" : null, "READY_TO_START", "IN_PROGRESS");
      if (isProxy) {
        insertAudit(
          db,
          operator.id,
          "PROXY_START",
          taskId,
          proxyReason,
          JSON.stringify({ status: "READY_TO_START" }),
          JSON.stringify({ status: "IN_PROGRESS", proofreaderId }),
          "PROOFREADER",
        );
      }
    })();
  } catch (e) {
    if (isUniqueViolation(e))
      throw new TaskServiceError("PROOFREADER_BUSY", "该校对人员已有进行中的任务，请先结束当前任务。");
    throw e;
  }
}

// ===== 4. 结束校对 =====

export interface FinishOptions {
  proxyReason?: string;
}

export function finishTask(
  db: Database.Database,
  taskId: number,
  operatorId: number,
  opts: FinishOptions = {},
): void {
  const operator = getActiveUser(db, operatorId);
  if (operator.role !== "PROOFREADER" && operator.role !== "INTERNAL_ADMIN") {
    throw new TaskServiceError("FORBIDDEN", "无权限：仅校对人员或超级管理员可结束");
  }

  const task = getTask(db, taskId);

  // 状态校验（幂等：已完成直接返回，不改变数据）
  if (task.status === "COMPLETED") return;
  if (task.status !== "IN_PROGRESS")
    throw new TaskServiceError("INVALID_STATUS", "当前状态不允许结束");

  let isProxy = false;
  let proxyReason = "";
  if (operator.role === "PROOFREADER") {
    if (task.proofreader_id !== operator.id)
      throw new TaskServiceError("NOT_TASK_PROOFREADER", "只有当前校对人员可结束该任务");
  } else {
    proxyReason = (opts.proxyReason ?? "").trim();
    if (!proxyReason)
      throw new TaskServiceError("PROXY_REASON_REQUIRED", "代操作需填写原因");
    if (proxyReason.length > 200)
      throw new TaskServiceError("INVALID_INPUT", "代操作原因最多 200 字");
    isProxy = true;
  }

  const finishedAt = now();

  db.transaction(() => {
    const info = db
      .prepare(
        "UPDATE tasks SET status='COMPLETED', finisher_id=?, finished_at=? WHERE id=? AND status='IN_PROGRESS'",
      )
      .run(operator.id, finishedAt, taskId);

    if (info.changes === 0) {
      const current = getTask(db, taskId);
      if (current.status === "COMPLETED") return; // 并发下幂等
      throw new TaskServiceError("INVALID_STATUS", "当前状态不允许结束");
    }

    insertEvent(db, taskId, EVENT_COMPLETED, operator, isProxy, isProxy ? "PROOFREADER" : null, "IN_PROGRESS", "COMPLETED");
    if (isProxy) {
      insertAudit(
        db,
        operator.id,
        "PROXY_FINISH",
        taskId,
        proxyReason,
        JSON.stringify({ status: "IN_PROGRESS", proofreader_id: task.proofreader_id }),
        JSON.stringify({ status: "COMPLETED" }),
        "PROOFREADER",
      );
    }
  })();
}

// ===== 5. 超级管理员取消 =====

export function cancelTask(
  db: Database.Database,
  taskId: number,
  operatorId: number,
  reason: string,
): void {
  const operator = getActiveUser(db, operatorId);

  const trimmedReason = (reason ?? "").trim();
  if (!trimmedReason)
    throw new TaskServiceError("PROXY_REASON_REQUIRED", "取消原因必填");
  if (trimmedReason.length > 200)
    throw new TaskServiceError("INVALID_INPUT", "取消原因最多 200 字");

  const task = getTask(db, taskId);
  if (task.status === "CANCELLED") return; // 幂等
  if (task.status === "IN_PROGRESS" || task.status === "COMPLETED")
    throw new TaskServiceError("INVALID_STATUS", "进行中或已结束的任务不能取消");

  // 权限判断：Dominance(INTERNAL_ADMIN) 可取消任意；责任编辑仅可取消自己书稿
  if (operator.role !== "INTERNAL_ADMIN" && operator.role !== "RESPONSIBLE_EDITOR") {
    throw new TaskServiceError("FORBIDDEN", "无权限：仅责任编辑或超级管理员可取消");
  }
  if (operator.role === "RESPONSIBLE_EDITOR") {
    const book = db
      .prepare(
        "SELECT b.editor_id FROM tasks t JOIN books b ON b.id = t.book_id WHERE t.id = ?",
      )
      .get(taskId) as { editor_id: number | null } | undefined;
    if (book?.editor_id !== operator.id)
      throw new TaskServiceError("FORBIDDEN", "无权取消其他责任编辑的任务");
  }

  const cancelledAt = now();
  const isProxy = operator.role === "INTERNAL_ADMIN";

  db.transaction(() => {
    const info = db
      .prepare(
        "UPDATE tasks SET status='CANCELLED', cancelled_by=?, cancelled_at=?, cancellation_reason=? WHERE id=? AND status IN ('PENDING_CONFIRMATION','READY_TO_START')",
      )
      .run(operator.id, cancelledAt, trimmedReason, taskId);

    if (info.changes === 0) {
      const current = getTask(db, taskId);
      if (current.status === "CANCELLED") return; // 并发下幂等
      throw new TaskServiceError("INVALID_STATUS", "当前状态不允许取消");
    }

    insertEvent(db, taskId, EVENT_CANCELLED, operator, isProxy, isProxy ? "RESPONSIBLE_EDITOR" : null, task.status, "CANCELLED");
    if (isProxy) {
      insertAudit(
        db,
        operator.id,
        "PROXY_CANCEL",
        taskId,
        trimmedReason,
        JSON.stringify({ status: task.status }),
        JSON.stringify({ status: "CANCELLED" }),
        "RESPONSIBLE_EDITOR",
      );
    }
  })();
}

// ===== 查询助手（供发布页面读取，避免 SQL 散落到页面组件） =====

export interface ExternalCompanyOption {
  id: number;
  name: string;
}

export function listActiveExternalCompanies(db: Database.Database): ExternalCompanyOption[] {
  return db
    .prepare(
      "SELECT id, name FROM companies WHERE type = 'EXTERNAL' AND is_active = 1 ORDER BY name, id",
    )
    .all() as ExternalCompanyOption[];
}

export interface BookOption {
  id: number;
  title: string;
  editorName: string | null;
}

// editorId 指定时只返回该责任编辑的书稿；省略时返回全部书稿（供超级管理员）。
export function listBooks(db: Database.Database, editorId?: number): BookOption[] {
  const base =
    "SELECT b.id, b.title, u.display_name AS editorName FROM books b LEFT JOIN users u ON u.id = b.editor_id";
  if (editorId != null) {
    return db.prepare(`${base} WHERE b.editor_id = ? ORDER BY b.id DESC`).all(editorId) as BookOption[];
  }
  return db.prepare(`${base} ORDER BY b.id DESC`).all() as BookOption[];
}

export interface EditorOption {
  id: number;
  display_name: string;
  username: string;
}

export function listActiveEditors(db: Database.Database): EditorOption[] {
  return db
    .prepare(
      "SELECT id, display_name, username FROM users WHERE role = 'RESPONSIBLE_EDITOR' AND is_active = 1 ORDER BY display_name, id",
    )
    .all() as EditorOption[];
}

export interface ProofreaderOption {
  id: number;
  display_name: string;
  username: string;
}

// 列出某外校公司下启用且已完成首次改密的校对人员（供管理员代开始选择）。
export function listActiveProofreaders(
  db: Database.Database,
  companyId: number,
): ProofreaderOption[] {
  return db
    .prepare(
      "SELECT id, display_name, username FROM users WHERE role = 'PROOFREADER' AND is_active = 1 AND company_id = ? ORDER BY display_name, id",
    )
    .all(companyId) as ProofreaderOption[];
}

// ===== 下一校次 =====

export interface BookNextStageInfo {
  bookId: number;
  title: string;
  editorId: number | null;
  editorName: string | null;
  latestCompletedStage: string | null;
  nextStage: string | null;
  latestCompletedAt: string | null;
  companyId: number | null;
  companyName: string | null;
  latestStarLevel: number | null;
  hasActiveTask: boolean;
}

function getBookStageState(
  db: Database.Database,
  bookId: number,
): {
  latestCompletedStage: string | null;
  nextStage: string | null;
  latestCompletedAt: string | null;
  companyId: number | null;
  companyName: string | null;
  latestStarLevel: number | null;
  hasActiveTask: boolean;
} {
  const latestCompleted = db
    .prepare(
      "SELECT stage, finished_at, star_level, company_id FROM tasks WHERE book_id = ? AND status = 'COMPLETED' ORDER BY id DESC LIMIT 1",
    )
    .get(bookId) as
    | { stage: string; finished_at: string | null; star_level: number; company_id: number | null }
    | undefined;
  const hasActiveTask =
    (
      db
        .prepare(
          "SELECT COUNT(*) c FROM tasks WHERE book_id = ? AND status IN ('PENDING_CONFIRMATION','READY_TO_START','IN_PROGRESS')",
        )
        .get(bookId) as { c: number }
    ).c > 0;
  const companyName =
    latestCompleted?.company_id != null
      ? ((db.prepare("SELECT name FROM companies WHERE id = ?").get(latestCompleted.company_id) as
          | { name: string }
          | undefined)?.name ?? null)
      : null;
  return {
    latestCompletedStage: latestCompleted?.stage ?? null,
    nextStage: latestCompleted ? nextStage(latestCompleted.stage) : null,
    latestCompletedAt: latestCompleted?.finished_at ?? null,
    companyId: latestCompleted?.company_id ?? null,
    companyName,
    latestStarLevel: latestCompleted?.star_level ?? null,
    hasActiveTask,
  };
}

// 计算下一校次；书稿不符合继续发起条件时抛业务错误。
function resolveNextStage(db: Database.Database, bookId: number): string {
  const state = getBookStageState(db, bookId);
  if (state.hasActiveTask)
    throw new TaskServiceError("BOOK_HAS_ACTIVE_TASK", "该书稿已有待处理的下一校次任务，请勿重复发布。");
  if (!state.latestCompletedStage)
    throw new TaskServiceError("NO_COMPLETED_STAGE", "该书稿没有已完成的校次");
  // 加校完成后可继续发起加校；旧数据若为已废弃校次则兜底沿用原校次
  return state.nextStage ?? state.latestCompletedStage;
}

// 列出可继续发起下一校次的书稿（至少一个已完成、无进行中任务、未到最高校次）。
export function listEligibleBooks(
  db: Database.Database,
  editorId?: number,
): BookNextStageInfo[] {
  const books = db
    .prepare(
      `SELECT b.id AS bookId, b.title, b.editor_id AS editorId, ed.display_name AS editorName
       FROM books b
       LEFT JOIN users ed ON ed.id = b.editor_id
       ${editorId != null ? "WHERE b.editor_id = ?" : ""}
       ORDER BY b.title, b.id`,
    )
    .all(...(editorId != null ? [editorId] : [])) as {
    bookId: number;
    title: string;
    editorId: number | null;
    editorName: string | null;
  }[];

  return books
    .map((b) => ({ ...b, ...getBookStageState(db, b.bookId) }))
    .filter(
      (r) => r.latestCompletedStage != null && !r.hasActiveTask && r.nextStage != null,
    );
}

// 按姓名或登录账号做部分匹配（不区分大小写），用于搜索型下拉框。
export function filterEditorsByQuery(
  editors: EditorOption[],
  query: string,
): EditorOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return editors;
  return editors.filter(
    (e) =>
      e.display_name.toLowerCase().includes(q) ||
      e.username.toLowerCase().includes(q),
  );
}

// 输入文字已偏离所选责任编辑姓名时应清除选择（防止显示名与实际 ID 不一致）。
export function editorSelectionClearsOn(
  selectedDisplayName: string | null,
  query: string,
): boolean {
  return selectedDisplayName != null && query.trim() !== selectedDisplayName;
}

// 判断角色是否为可代发布的超级管理员（发布页面据此决定是否显示代发布区域）。
export function isAdminRole(role: string): boolean {
  return role === "INTERNAL_ADMIN";
}

// ===== 待确认收稿列表查询（仅供页面读取，不返回敏感字段） =====

export interface PendingConfirmationItem {
  id: number;
  bookId: number;
  title: string;
  stage: string;
  workType: string;
  starLevel: number;
  editorId: number | null;
  editorName: string | null;
  publisherCompanyName: string | null;
  companyName: string | null;
  companyId: number | null;
  publishedAt: string;
  status: string;
}

export function listPendingConfirmation(
  db: Database.Database,
): PendingConfirmationItem[] {
  return db
    .prepare(
      `SELECT t.id, b.id AS bookId, b.title, t.stage, t.work_type AS workType, t.star_level AS starLevel,
              b.editor_id AS editorId,
              t.published_at AS publishedAt, t.status, t.company_id AS companyId,
              u.display_name AS editorName,
              cu.name AS publisherCompanyName,
              c.name AS companyName
       FROM tasks t
       JOIN books b ON b.id = t.book_id
       LEFT JOIN users u ON u.id = t.publisher_id
       LEFT JOIN companies cu ON cu.id = u.company_id
       LEFT JOIN companies c ON c.id = t.company_id
       WHERE t.status = 'PENDING_CONFIRMATION'
       ORDER BY t.star_level DESC, t.published_at ASC, t.id ASC`,
    )
    .all() as PendingConfirmationItem[];
}

export function countPendingConfirmation(db: Database.Database): number {
  return (db.prepare("SELECT COUNT(*) c FROM tasks WHERE status = 'PENDING_CONFIRMATION'").get() as { c: number }).c;
}
