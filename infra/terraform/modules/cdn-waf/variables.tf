variable "name_prefix" {
  type = string
}

variable "zone_id" {
  description = "Cloudflare zone ID"
  type        = string
}

variable "manage_zone_settings" {
  description = <<-EOT
    true: Terraform quản lý cài đặt CẤP ZONE (SSL strict, Always HTTPS, TLS tối thiểu...).
    Cài đặt áp cho cả zone → nếu nhiều môi trường dùng chung zone, chỉ MỘT state được bật.
  EOT
  type        = bool
  default     = true
}

variable "zone_settings_overrides" {
  description = "Ghi đè/bổ sung setting_id → value (cloudflare_zone_setting)"
  type        = map(string)
  default     = {}
}

variable "manage_waf" {
  description = <<-EOT
    true: tạo entrypoint ruleset cho phase http_request_firewall_custom và http_ratelimit.
    Mỗi zone chỉ có MỘT entrypoint ruleset cho mỗi phase → chỉ một state được bật; state đó liệt kê host của mọi
    môi trường dùng chung zone (biến hosts). Nếu đã tạo rule trên dashboard: `terraform import` trước khi apply.
  EOT
  type        = bool
  default     = true
}

variable "hosts" {
  description = "Nhóm host → danh sách hostname áp rule (khoá: api, web, cms)"
  type        = map(list(string))

  validation {
    condition     = alltrue([for k in keys(var.hosts) : contains(["api", "web", "cms"], k)])
    error_message = "hosts chỉ nhận khoá api, web, cms."
  }
}

variable "admin_paths" {
  description = "Nhóm host → tiền tố đường dẫn quản trị chỉ cho phép từ admin_allowed_countries/admin_allowed_ips"
  type        = map(list(string))
  default = {
    cms = ["/admin"]
    api = ["/v1/admin", "/docs"]
  }
}

variable "admin_geo_block_enabled" {
  type    = bool
  default = true
}

variable "admin_allowed_countries" {
  description = "Mã quốc gia ISO 3166-1 alpha-2 được vào đường dẫn quản trị"
  type        = list(string)
  default     = ["VN"]
}

variable "admin_allowed_ips" {
  description = "CIDR được vào đường dẫn quản trị dù ở ngoài admin_allowed_countries (VPN, văn phòng)"
  type        = list(string)
  default     = []
}

variable "internal_paths" {
  description = "Tiền tố đường dẫn nội bộ của api (CMS gọi qua mạng nội bộ ACA) – chặn hoàn toàn từ Internet"
  type        = list(string)
  default     = ["/v1/internal/"]
}

variable "auth_rate_limit" {
  description = <<-EOT
    Rate limit cho /v1/auth/*. Mặc định tương thích gói Free: chỉ dùng trường path, đặc tính IP, chu kỳ 10s,
    timeout 10s, tối đa 1 rule. scope_to_host = true (gói Pro+) giới hạn thêm theo host api.
  EOT
  type = object({
    enabled             = optional(bool, true)
    path_prefix         = optional(string, "/v1/auth/")
    requests_per_period = optional(number, 20)
    period              = optional(number, 10)
    mitigation_timeout  = optional(number, 10)
    action              = optional(string, "block")
    scope_to_host       = optional(bool, false)
  })
  default = {}
}
