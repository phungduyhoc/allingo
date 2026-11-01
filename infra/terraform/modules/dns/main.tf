# Bản ghi Cloudflare cho các app Container Apps (ADR-0023), cú pháp provider cloudflare v5 (`cloudflare_dns_record`):
#   - CNAME <name> → <app>.<env>.southeastasia.azurecontainerapps.io (proxied: WAF + TLS ở edge)
#   - TXT asuid.<name> = custom_domain_verification_id → Azure xác minh quyền sở hữu khi bind custom domain
#
# Lưu ý TLS: Universal SSL (gói Free) chỉ phủ `allingo.vn` và `*.allingo.vn` (một cấp). Vì vậy staging dùng
# `api-staging.allingo.vn` thay vì `api.staging.allingo.vn` (cấp hai cần Advanced Certificate Manager).

resource "cloudflare_dns_record" "cname" {
  for_each = var.records

  zone_id = var.zone_id
  name    = each.value.name
  type    = "CNAME"
  content = each.value.target
  proxied = var.proxied
  ttl     = 1 # 1 = automatic (bắt buộc khi proxied)
  comment = "${var.comment} – ${each.key} → Azure Container Apps"
}

resource "cloudflare_dns_record" "asuid" {
  for_each = var.records

  zone_id = var.zone_id
  name    = "asuid.${each.value.name}"
  type    = "TXT"
  # Cloudflare khuyến nghị bọc nội dung TXT trong dấu nháy kép (tránh cảnh báo/drift ở provider v5)
  content = "\"${var.verification_id}\""
  proxied = false
  ttl     = 3600
  comment = "${var.comment} – xác minh custom domain Container Apps (${each.key})"
}
