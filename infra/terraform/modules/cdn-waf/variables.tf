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

variable "extra_rate_limits" {
  description = <<-EOT
    S11: rule rate limit bổ sung (gói Pro: tổng 2 rule, Business: 5) – mặc định rỗng để tương thích gói Free (1 rule = auth_rate_limit).
    Ví dụ staging/prod: OTP chặt hơn login, webhook theo IP cổng. Mỗi phần tử: ref, path_prefix, requests_per_period, period,
    mitigation_timeout, action (block | managed_challenge | log).
  EOT
  type = list(object({
    ref                 = string
    path_prefix         = string
    requests_per_period = number
    period              = optional(number, 60)
    mitigation_timeout  = optional(number, 60)
    action              = optional(string, "block")
  }))
  default = []
}

variable "webhook_ip_allowlist" {
  description = <<-EOT
    S11: IP allowlist webhook theo cổng thanh toán (nếu cổng công bố dải IP): provider → danh sách CIDR. Request tới
    /v1/webhooks/payments/<provider> từ IP ngoài danh sách bị chặn ở edge (API vẫn xác minh chữ ký). Rỗng = không áp.
    Ví dụ (dải tài liệu RFC 5737, KHÔNG phải IP thật): { vnpay = ["203.0.113.10/32"] } – lấy dải IP từ tài liệu/hợp đồng tích hợp của cổng.
  EOT
  type        = map(list(string))
  default     = {}
}
