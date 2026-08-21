-- 出版校对流程管理平台 —— SQLite 数据库结构
-- 时间统一存 UTC ISO-8601 字符串（可排序），页面按 Asia/Shanghai 展示。
-- 所有表使用 IF NOT EXISTS，重复执行不覆盖、不报错。

-- 公司/部门
CREATE TABLE IF NOT EXISTS companies (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  type       TEXT    NOT NULL CHECK (type IN ('INTERNAL', 'EXTERNAL')),
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 用户/账号
CREATE TABLE IF NOT EXISTS users (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  username             TEXT    NOT NULL UNIQUE,
  display_name         TEXT    NOT NULL,
  company_id           INTEGER REFERENCES companies(id),
  role                 TEXT    NOT NULL CHECK (role IN (
                         'RESPONSIBLE_EDITOR', 'EXTERNAL_SUPERVISOR', 'PROOFREADER', 'INTERNAL_ADMIN'
                       )),
  is_active            INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  password_hash        TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
  failed_login_count   INTEGER NOT NULL DEFAULT 0,
  locked_until         TEXT,
  last_login_at        TEXT,
  session_version      INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 图书项目（一本书可能有多个校次任务；书名不要求全局唯一）
CREATE TABLE IF NOT EXISTS books (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT    NOT NULL,
  editor_id  INTEGER REFERENCES users(id),
  identifier TEXT,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 校对任务（一本书的一次具体校次）
CREATE TABLE IF NOT EXISTS tasks (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id             INTEGER NOT NULL REFERENCES books(id),
  -- 校次
  stage               TEXT    NOT NULL CHECK (stage IN (
                        'INITIAL_REVIEW', 'FIRST_PROOF', 'SECOND_PROOF',
                        'THIRD_PROOF', 'ADDITIONAL_PROOF', 'RED_CHECK'
                      )),
  -- 本次工作内容：读校 / 核红 / 读校且核红
  work_type           TEXT    NOT NULL DEFAULT 'PROOFREAD' CHECK (work_type IN (
                        'PROOFREAD', 'RED_CHECK', 'PROOFREAD_AND_RED_CHECK'
                      )),
  -- 星级：1=普通 2=加急 3=重要急稿
  star_level          INTEGER NOT NULL CHECK (star_level BETWEEN 1 AND 3),
  status              TEXT    NOT NULL DEFAULT 'PENDING_CONFIRMATION' CHECK (status IN (
                        'PENDING_CONFIRMATION', 'READY_TO_START', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'
                      )),
  note                TEXT,
  -- 发布（发布时间 = 来稿时间 = 滞留计时起点）
  publisher_id        INTEGER REFERENCES users(id),
  published_at        TEXT,
  -- 接收外校公司（发布时确定，后续由该公司主管确认收稿）
  company_id          INTEGER REFERENCES companies(id),
  -- 确认收稿
  confirmer_id        INTEGER REFERENCES users(id),
  confirm_company_id  INTEGER REFERENCES companies(id),
  confirmed_at        TEXT,
  -- 开始校对（校对负责人 = 开始操作人，开始时间 = 进入生产线时间）
  proofreader_id      INTEGER REFERENCES users(id),
  started_at          TEXT,
  -- 结束
  finisher_id         INTEGER REFERENCES users(id),
  finished_at         TEXT,
  -- 取消
  cancelled_by        INTEGER REFERENCES users(id),
  cancelled_at        TEXT,
  cancellation_reason TEXT,
  created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 流程事件（只追加）
CREATE TABLE IF NOT EXISTS task_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id       INTEGER NOT NULL REFERENCES tasks(id),
  event_type    TEXT    NOT NULL CHECK (event_type IN (
                  'TASK_PUBLISHED', 'RECEIPT_CONFIRMED', 'TASK_STARTED', 'TASK_COMPLETED', 'TASK_CANCELLED'
                )),
  operator_id   INTEGER REFERENCES users(id),
  operator_role TEXT,
  is_proxy      INTEGER NOT NULL DEFAULT 0 CHECK (is_proxy IN (0, 1)),
  proxy_role    TEXT,
  status_from   TEXT,
  status_to     TEXT,
  note          TEXT,
  occurred_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 审计日志（超级管理员代操作/纠错，只追加）
CREATE TABLE IF NOT EXISTS audit_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  operator_id    INTEGER REFERENCES users(id),
  operation_type TEXT    NOT NULL,
  target_type    TEXT    NOT NULL,
  target_id      TEXT    NOT NULL,
  reason         TEXT,
  before_value   TEXT,
  after_value    TEXT,
  proxy_role     TEXT,
  occurred_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ===== 约束与索引 =====

-- 一人一书：一名校对人员同一时段最多一条进行中任务（部分唯一索引）
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_one_active_per_proofreader
  ON tasks(proofreader_id) WHERE status = 'IN_PROGRESS';

-- 常用查询索引
CREATE INDEX IF NOT EXISTS idx_tasks_status       ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_published_at ON tasks(published_at);
CREATE INDEX IF NOT EXISTS idx_tasks_proofreader  ON tasks(proofreader_id);
CREATE INDEX IF NOT EXISTS idx_tasks_publisher    ON tasks(publisher_id);
CREATE INDEX IF NOT EXISTS idx_tasks_book_id      ON tasks(book_id);
CREATE INDEX IF NOT EXISTS idx_books_title        ON books(title);
CREATE INDEX IF NOT EXISTS idx_task_events_task   ON task_events(task_id);
CREATE INDEX IF NOT EXISTS idx_task_events_time   ON task_events(occurred_at);

-- ===== 只追加保护（禁止 UPDATE / DELETE）=====

CREATE TRIGGER IF NOT EXISTS trg_task_events_no_update
BEFORE UPDATE ON task_events
BEGIN
  SELECT RAISE(ABORT, 'task_events is append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_task_events_no_delete
BEFORE DELETE ON task_events
BEGIN
  SELECT RAISE(ABORT, 'task_events is append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;
