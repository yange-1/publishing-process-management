// 统计报表中心 —— 权限（纯函数，便于测试）。
// 仅 INTERNAL_ADMIN 与 EXTERNAL_SUPERVISOR 可访问；公司范围由服务端按登录用户强制确定，
// 绝不信任 URL / 表单 / 前端传入的 company_id。

// 是否允许访问报表中心。
export function canAccessReport(role: string): boolean {
  return role === "INTERNAL_ADMIN" || role === "EXTERNAL_SUPERVISOR";
}

// 报表数据范围：
// - INTERNAL_ADMIN → null（全局，全平台）；
// - EXTERNAL_SUPERVISOR → 本人 company_id（无公司时返回 -1，表示空范围，避免误用全局）。
export function reportCompanyScope(role: string, companyId: number | null): number | null {
  if (role === "INTERNAL_ADMIN") return null;
  if (role === "EXTERNAL_SUPERVISOR") return companyId ?? -1;
  return null;
}
