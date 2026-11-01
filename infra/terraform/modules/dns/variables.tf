variable "zone_id" {
  description = "Cloudflare zone ID (ví dụ zone allingo.vn)"
  type        = string
}

variable "records" {
  description = <<-EOT
    Map khoá logic → { name = FQDN công khai, target = FQDN Container App }.
    Ví dụ: { web = { name = "app-staging.allingo.vn", target = "allingo-staging-web.<id>.southeastasia.azurecontainerapps.io" } }
  EOT
  type = map(object({
    name   = string
    target = string
  }))
}

variable "verification_id" {
  description = "custom_domain_verification_id của Container Apps Environment (TXT asuid.<name>)"
  type        = string
  sensitive   = true
}

variable "proxied" {
  description = <<-EOT
    true: lưu lượng đi qua Cloudflare (WAF, cache, ẩn origin). Nếu Azure báo lỗi xác minh CNAME khi tạo custom domain lần đầu,
    apply một lần với false, chờ binding thành công rồi bật lại true (docs/runbooks/deploy-staging.md – Bootstrap).
  EOT
  type        = bool
  default     = true
}

variable "comment" {
  description = "Ghi chú gắn vào bản ghi (ai/điều gì quản lý)"
  type        = string
  default     = "managed by terraform (allingo)"
}
