# Biến của môi trường staging. envs/dev/variables.tf có CÙNG danh sách biến, chỉ khác giá trị mặc định
# (main.tf của hai môi trường giống hệt nhau). Giá trị riêng đặt trong terraform.tfvars (xem terraform.tfvars.example).

# --- Chung -----------------------------------------------------------------------------

variable "subscription_id" {
  description = "Azure subscription ID; null → ARM_SUBSCRIPTION_ID hoặc subscription mặc định của az CLI"
  type        = string
  default     = null
}

variable "project" {
  type    = string
  default = "allingo"
}

variable "environment" {
  type    = string
  default = "staging"

  validation {
    condition     = contains(["dev", "staging"], var.environment)
    error_message = "environment phải là dev hoặc staging (production có env riêng)."
  }
}

variable "location" {
  description = "Phương án B: Azure Southeast Asia (Singapore)"
  type        = string
  default     = "southeastasia"
}

variable "resource_group_name" {
  description = "null → <project>-<environment>-rg"
  type        = string
  default     = null
}

variable "tags" {
  type    = map(string)
  default = {}
}

# --- Mạng ------------------------------------------------------------------------------

variable "vnet_address_space" {
  type    = string
  default = "10.20.0.0/16"
}

variable "aca_subnet_prefix" {
  type    = string
  default = "10.20.0.0/24"
}

variable "postgres_subnet_prefix" {
  type    = string
  default = "10.20.1.0/28"
}

variable "private_endpoints_subnet_prefix" {
  type    = string
  default = "10.20.2.0/27"
}

# --- Quan sát --------------------------------------------------------------------------

variable "log_retention_days" {
  description = "Giá trị hợp lệ cho Application Insights: 30, 60, 90, 120, 180, 270, 365, 550, 730"
  type        = number
  default     = 90
}

variable "log_daily_quota_gb" {
  type    = number
  default = 2
}

variable "appinsights_sampling_percentage" {
  type    = number
  default = 50
}

variable "otel_collector_enabled" {
  description = "Chạy OTel Collector nội bộ và bật OTEL_ENABLED cho api/worker"
  type        = bool
  default     = true
}

# --- Dữ liệu ---------------------------------------------------------------------------

variable "postgres_sku_name" {
  type    = string
  default = "B_Standard_B1ms"
}

variable "postgres_storage_mb" {
  type    = number
  default = 32768
}

variable "postgres_backup_retention_days" {
  description = "PITR 30 ngày (S11: staging/prod 30, dev 7 – docs/runbooks/restore.md)"
  type        = number
  default     = 30
}

variable "postgres_geo_redundant_backup" {
  description = "S11: backup geo-redundant (production bật; chỉ đặt khi tạo server)"
  type        = bool
  default     = false
}

variable "postgres_max_connections" {
  description = "S11: max_connections của SKU (ngưỡng alert 80 %)"
  type        = number
  default     = 50
}

variable "redis_sku_name" {
  description = "Basic = 1 node, không SLA (HA tắt theo yêu cầu staging)"
  type        = string
  default     = "Basic"
}

variable "redis_capacity" {
  description = "0 = 250 MB (C0)"
  type        = number
  default     = 0
}

variable "meili_cpu" {
  type    = number
  default = 0.5
}

variable "meili_memory" {
  type    = string
  default = "1Gi"
}

variable "meili_max_indexing_memory" {
  type    = string
  default = "512Mb"
}

variable "key_vault_purge_protection" {
  description = "Không tắt được sau khi bật"
  type        = bool
  default     = true
}

# --- Image -----------------------------------------------------------------------------

variable "image_registry" {
  type    = string
  default = "ghcr.io"
}

variable "image_owner" {
  description = "Owner GitHub (org/user) chứa package ghcr.io/<owner>/allingo-{api,web,cms}"
  type        = string
}

variable "image_tag" {
  description = "Tag image khi TẠO app lần đầu (CI truyền sha-<commit>). Sau đó image do deploy-staging.yml quản lý"
  type        = string
  default     = "latest"
}

variable "web_image_tag_suffix" {
  description = "Image web nhúng NEXT_PUBLIC_* lúc build nên có hậu tố theo môi trường (sha-<commit>-staging)"
  type        = string
  default     = "-staging"
}

variable "ghcr_username" {
  description = "Tài khoản đọc package GHCR private; null = package public (không cần credentials)"
  type        = string
  default     = null
}

variable "ghcr_pull_token" {
  description = "PAT (classic) quyền read:packages – ghi vào Key Vault secret ghcr-pull-token"
  type        = string
  default     = ""
  sensitive   = true
}

# --- Ứng dụng --------------------------------------------------------------------------

variable "app_scale" {
  description = "Tài nguyên & số replica (cặp cpu/memory hợp lệ của Consumption: 0.25/0.5Gi, 0.5/1Gi, 1/2Gi...)"
  type = map(object({
    cpu          = number
    memory       = string
    min_replicas = number
    max_replicas = number
  }))
  default = {
    api    = { cpu = 0.5, memory = "1Gi", min_replicas = 1, max_replicas = 3 }
    worker = { cpu = 0.25, memory = "0.5Gi", min_replicas = 1, max_replicas = 1 }
    web    = { cpu = 0.5, memory = "1Gi", min_replicas = 1, max_replicas = 3 }
    cms    = { cpu = 0.5, memory = "1Gi", min_replicas = 1, max_replicas = 1 }
  }

  validation {
    condition     = alltrue([for k in ["api", "worker", "web", "cms"] : contains(keys(var.app_scale), k)])
    error_message = "app_scale phải có đủ khoá api, worker, web, cms."
  }
}

variable "log_level" {
  type    = string
  default = "info"
}

variable "db_pool_max" {
  description = "B1ms cho tối đa 50 kết nối: (api max_replicas + worker) × db_pool_max + pool của cms (~10) phải nhỏ hơn"
  type        = number
  default     = 6
}

variable "ai_provider" {
  description = "mock | live (live cần khoá AI trong Key Vault – external_secret_env)"
  type        = string
  default     = "mock"
}

variable "speech_provider" {
  description = "mock | azure"
  type        = string
  default     = "mock"
}

variable "smtp_host" {
  type    = string
  default = ""
}

variable "smtp_port" {
  type    = number
  default = 587
}

variable "smtp_user" {
  type    = string
  default = ""
}

variable "smtp_from" {
  type    = string
  default = "Allingo <no-reply@allingo.vn>"
}

variable "api_extra_env" {
  description = "Env thường (không bí mật) bổ sung/ghi đè cho api + worker, ví dụ GOOGLE_CLIENT_ID"
  type        = map(string)
  default     = {}
}

variable "web_extra_env" {
  type    = map(string)
  default = {}
}

variable "cms_extra_env" {
  type    = map(string)
  default = {}
}

variable "external_secret_env" {
  description = <<-EOT
    Secret của bên thứ ba cho api + worker, ĐẶT TAY trong Key Vault (không qua Terraform state):
    map ENV → tên secret Key Vault, ví dụ { GOOGLE_GENERATIVE_AI_API_KEY = "google-generative-ai-api-key" }.
    Tạo secret trước (az keyvault secret set) rồi mới thêm vào đây – xem docs/runbooks/secrets.md.
  EOT
  type        = map(string)
  default     = {}
}

# --- Cloudflare (R2 luôn dùng; DNS/WAF/custom domain bật bằng enable_cloudflare) -------

variable "cloudflare_api_token" {
  description = "null → CLOUDFLARE_API_TOKEN"
  type        = string
  default     = null
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Account ID chứa R2 (và zone)"
  type        = string
}

variable "r2_create_api_token" {
  description = "true: Terraform tạo API token R2 (token Terraform cần quyền 'API Tokens: Edit'); false: nhập khoá S3 tạo tay"
  type        = bool
  default     = true
}

variable "r2_access_key_id" {
  type    = string
  default = ""
}

variable "r2_secret_access_key" {
  type      = string
  default   = ""
  sensitive = true
}

variable "enable_cloudflare" {
  description = "Bật DNS + WAF + custom domain trên zone Cloudflare. false → dùng FQDN *.azurecontainerapps.io"
  type        = bool
  default     = true
}

variable "cloudflare_zone_id" {
  type    = string
  default = ""

  validation {
    condition     = !var.enable_cloudflare || length(var.cloudflare_zone_id) > 0
    error_message = "enable_cloudflare = true cần cloudflare_zone_id."
  }
}

variable "cloudflare_zone_name" {
  description = "Ví dụ allingo.vn"
  type        = string
  default     = ""

  validation {
    condition     = !var.enable_cloudflare || length(var.cloudflare_zone_name) > 0
    error_message = "enable_cloudflare = true cần cloudflare_zone_name."
  }
}

variable "dns_name_suffix" {
  description = "Hậu tố nhãn DNS: app<suffix>, api<suffix>, cms<suffix>, media<suffix> (một cấp để Universal SSL phủ được)"
  type        = string
  default     = "-staging"
}

variable "cloudflare_proxied" {
  type    = bool
  default = true
}

variable "cloudflare_manage_zone_settings" {
  description = "Chỉ MỘT state trên mỗi zone được bật (cài đặt cấp zone)"
  type        = bool
  default     = true
}

variable "cloudflare_manage_waf" {
  description = "Chỉ MỘT state trên mỗi zone được bật (entrypoint ruleset mỗi phase là duy nhất)"
  type        = bool
  default     = true
}

variable "cloudflare_waf_extra_hosts" {
  description = "Host của môi trường khác dùng chung zone để áp cùng rule WAF (khoá api|web|cms)"
  type        = map(list(string))
  default     = {}
}

variable "admin_allowed_countries" {
  type    = list(string)
  default = ["VN"]
}

variable "admin_allowed_ips" {
  type    = list(string)
  default = []
}

variable "auth_rate_limit" {
  description = "Xem modules/cdn-waf (mặc định tương thích gói Free)"
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

variable "restrict_ingress_to_cloudflare" {
  description = "Chỉ nhận traffic từ dải IP Cloudflare (+ subnet ACA cho gọi nội bộ) – chặn đi vòng WAF qua FQDN Azure"
  type        = bool
  default     = true
}

variable "extra_ingress_allowed_cidrs" {
  type    = list(string)
  default = []
}

variable "origin_certificate_pfx_base64" {
  description = "Cloudflare Origin CA (PFX base64) phủ app/api/cms<suffix>.<zone> – bắt buộc khi enable_cloudflare"
  type        = string
  default     = ""
  sensitive   = true

  validation {
    condition     = !var.enable_cloudflare || length(var.origin_certificate_pfx_base64) > 0
    error_message = "enable_cloudflare = true cần origin_certificate_pfx_base64 (docs/runbooks/secrets.md – Origin CA)."
  }
}

variable "origin_certificate_password" {
  type      = string
  default   = ""
  sensitive = true
}

# ---------------------------------------------------------------- S11: alert hạ tầng, uptime, WAF bổ sung
variable "infra_alerts_enabled" {
  type    = bool
  default = true
}

variable "alert_emails" {
  type    = list(string)
  default = []
}

variable "alert_webhook_url" {
  description = "Slack incoming webhook / Alertmanager webhook – TF_VAR_alert_webhook_url (không commit)"
  type        = string
  default     = null
  sensitive   = true
}

variable "uptime_urls" {
  type    = map(string)
  default = {}
}

variable "extra_rate_limits" {
  description = "Xem modules/cdn-waf – gói Free để rỗng (1 rule)"
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
  description = "provider → CIDR của cổng thanh toán (modules/cdn-waf)"
  type        = map(list(string))
  default     = {}
}
