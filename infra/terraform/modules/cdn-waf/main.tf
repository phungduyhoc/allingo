# Cloudflare edge cho phương án B (ADR-0023), cú pháp provider cloudflare v5:
#   - cloudflare_zone_setting: SSL Full (strict) (origin dùng chứng chỉ Cloudflare Origin CA gắn vào Container Apps),
#     Always Use HTTPS, TLS tối thiểu 1.2, TLS 1.3, WebSocket (Socket.IO).
#   - cloudflare_ruleset phase http_request_firewall_custom: chặn /v1/internal/* từ Internet; chỉ cho phép đường dẫn
#     quản trị (/admin của CMS, /v1/admin & /docs của API) từ VN hoặc IP được phép.
#   - cloudflare_ruleset phase http_ratelimit: giới hạn /v1/auth/* theo IP (chống dò mật khẩu/OTP; bổ sung cho
#     rate limit trong API và khoá OTP 5 lần sai – CLAUDE.md §9).
#   - data cloudflare_ip_ranges: dải IP Cloudflare để khoá ingress Container Apps (chỉ nhận traffic qua edge).

locals {
  zone_settings = merge({
    ssl                      = "strict"
    always_use_https         = "on"
    min_tls_version          = "1.2"
    tls_1_3                  = "on"
    automatic_https_rewrites = "on"
    websockets               = "on"
    opportunistic_encryption = "on"
    browser_check            = "on"
  }, var.zone_settings_overrides)

  # Danh sách host dạng biểu thức Cloudflare: {"a.allingo.vn" "b.allingo.vn"}
  host_sets = { for group, hs in var.hosts : group => join(" ", [for h in hs : jsonencode(h)]) }

  internal_expression = length(lookup(var.hosts, "api", [])) > 0 && length(var.internal_paths) > 0 ? format(
    "(http.host in {%s} and (%s))",
    local.host_sets["api"],
    join(" or ", [for p in var.internal_paths : "starts_with(http.request.uri.path, ${jsonencode(p)})"]),
  ) : null

  admin_conditions = flatten([
    for group, paths in var.admin_paths : [
      for p in paths : "(http.host in {${local.host_sets[group]}} and starts_with(http.request.uri.path, ${jsonencode(p)}))"
    ] if length(lookup(var.hosts, group, [])) > 0
  ])

  admin_allow_clause = join("", [
    " and not ip.src.country in {${join(" ", [for c in var.admin_allowed_countries : jsonencode(c)])}}",
    length(var.admin_allowed_ips) > 0 ? " and not ip.src in {${join(" ", var.admin_allowed_ips)}}" : "",
  ])

  admin_expression = var.admin_geo_block_enabled && length(local.admin_conditions) > 0 ? "(${join(" or ", local.admin_conditions)})${local.admin_allow_clause}" : null

  firewall_rules = concat(
    local.internal_expression == null ? [] : [{
      ref         = "block_internal_api"
      description = "Chặn API nội bộ (CMS gọi qua mạng nội bộ Container Apps)"
      expression  = local.internal_expression
      action      = "block"
      enabled     = true
    }],
    local.admin_expression == null ? [] : [{
      ref         = "geo_restrict_admin"
      description = "Đường dẫn quản trị chỉ từ ${join(",", var.admin_allowed_countries)} hoặc IP được phép"
      expression  = local.admin_expression
      action      = "block"
      enabled     = true
    }],
  )

  # Gói Free chỉ cho phép trường path trong biểu thức rate limit → dùng `contains` (toán tử cơ bản);
  # Pro+ (scope_to_host) giới hạn thêm theo host api.
  rate_limit_expression = var.auth_rate_limit.scope_to_host ? format(
    "(http.host in {%s} and starts_with(http.request.uri.path, %s))",
    lookup(local.host_sets, "api", ""),
    jsonencode(var.auth_rate_limit.path_prefix),
  ) : "(http.request.uri.path contains ${jsonencode(var.auth_rate_limit.path_prefix)})"
}

resource "cloudflare_zone_setting" "this" {
  for_each = { for k, v in local.zone_settings : k => v if var.manage_zone_settings }

  zone_id    = var.zone_id
  setting_id = each.key
  value      = each.value
}

resource "cloudflare_ruleset" "firewall_custom" {
  count = var.manage_waf && length(local.firewall_rules) > 0 ? 1 : 0

  zone_id     = var.zone_id
  name        = "${var.name_prefix} – custom firewall rules"
  description = "Quản lý bởi Terraform (infra/terraform/modules/cdn-waf)"
  kind        = "zone"
  phase       = "http_request_firewall_custom"
  rules       = local.firewall_rules
}

resource "cloudflare_ruleset" "rate_limit" {
  count = var.manage_waf && var.auth_rate_limit.enabled ? 1 : 0

  zone_id     = var.zone_id
  name        = "${var.name_prefix} – rate limiting"
  description = "Quản lý bởi Terraform (infra/terraform/modules/cdn-waf)"
  kind        = "zone"
  phase       = "http_ratelimit"

  rules = [{
    ref         = "rate_limit_auth"
    description = "Giới hạn ${var.auth_rate_limit.requests_per_period} yêu cầu/${var.auth_rate_limit.period}s/IP cho ${var.auth_rate_limit.path_prefix}*"
    expression  = local.rate_limit_expression
    action      = var.auth_rate_limit.action
    enabled     = true
    ratelimit = {
      characteristics     = ["cf.colo.id", "ip.src"]
      period              = var.auth_rate_limit.period
      requests_per_period = var.auth_rate_limit.requests_per_period
      mitigation_timeout  = var.auth_rate_limit.mitigation_timeout
    }
  }]
}

# Dải IP edge Cloudflare (để giới hạn ingress Container Apps)
data "cloudflare_ip_ranges" "this" {}
