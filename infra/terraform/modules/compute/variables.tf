variable "name_prefix" {
  description = "Tiền tố tên tài nguyên, ví dụ allingo-staging (app: <prefix>-api, <prefix>-worker, ...)"
  type        = string
}

variable "location" {
  type = string
}

variable "resource_group_name" {
  type = string
}

# --- Environment -----------------------------------------------------------------

variable "infrastructure_subnet_id" {
  description = "Subnet uỷ quyền Microsoft.App/environments (module network: aca_subnet_id)"
  type        = string
}

variable "log_analytics_workspace_id" {
  description = "Resource ID Log Analytics (module observability) nhận log console/system của Container Apps"
  type        = string
}

variable "zone_redundancy_enabled" {
  description = "Zone redundancy cho environment (chỉ prod; không đổi được sau khi tạo)"
  type        = bool
  default     = false
}

# --- Danh tính & secret ---------------------------------------------------------------

variable "identity_id" {
  description = "Resource ID user-assigned identity có vai trò 'Key Vault Secrets User' (module secrets: identity_id)"
  type        = string
}

variable "secret_refs" {
  description = "Map tên secret (chữ thường, gạch ngang) → versionless secret ID trong Key Vault. Mọi tên dùng trong *.secret_env phải có ở đây"
  type        = map(string)
}

variable "registry" {
  description = "Registry image. username = null → image public (không khai báo registry credentials)"
  type = object({
    server               = optional(string, "ghcr.io")
    username             = optional(string)
    password_secret_name = optional(string)
  })
  default = {}

  validation {
    condition     = var.registry.username == null || var.registry.password_secret_name != null
    error_message = "registry.password_secret_name bắt buộc khi đặt registry.username."
  }
}

# --- Ingress ---------------------------------------------------------------------------

variable "ingress_allowed_cidrs" {
  description = "Nếu khác rỗng: chỉ cho phép các CIDR này vào ingress api/web/cms (Cloudflare IPv4 + subnet ACA). Rỗng = mở"
  type        = list(string)
  default     = []
}

variable "api_allow_insecure_connections" {
  description = <<-EOT
    true: ingress api nhận cả HTTP để CMS gọi nội bộ http://<prefix>-api/v1 mà không bị chuyển hướng 301 sang HTTPS.
    Truy cập public vẫn qua Cloudflare (HTTPS, Always Use HTTPS) và bị giới hạn bởi ingress_allowed_cidrs.
    Cần xác minh trên môi trường thật (ADR-0023); nếu gọi nội bộ không bị chuyển hướng thì đặt false.
  EOT
  type        = bool
  default     = true
}

# --- Ứng dụng ------------------------------------------------------------------------
# cpu/memory theo cặp hợp lệ của Consumption: 0.25/0.5Gi, 0.5/1Gi, 0.75/1.5Gi, 1/2Gi, ... (tỉ lệ 1:2)

variable "api" {
  description = "API NestJS (ingress external :4000)"
  type = object({
    image               = string
    cpu                 = optional(number, 0.5)
    memory              = optional(string, "1Gi")
    min_replicas        = optional(number, 1)
    max_replicas        = optional(number, 3)
    concurrent_requests = optional(number, 50)
    revision_mode       = optional(string, "Multiple")
    env                 = optional(map(string), {})
    secret_env          = optional(map(string), {})
  })
}

variable "worker" {
  description = "Worker BullMQ – cùng image với api, không ingress"
  type = object({
    cpu                              = optional(number, 0.25)
    memory                           = optional(string, "0.5Gi")
    min_replicas                     = optional(number, 1)
    max_replicas                     = optional(number, 1)
    termination_grace_period_seconds = optional(number, 120)
    env                              = optional(map(string), {})
    secret_env                       = optional(map(string), {})
  })
  default = {}

  validation {
    condition     = var.worker.min_replicas >= 1
    error_message = "worker.min_replicas phải >= 1 (worker không có HTTP nên không tự scale từ 0)."
  }
}

variable "web" {
  description = "Web Next.js standalone (ingress external :3000)"
  type = object({
    image               = string
    cpu                 = optional(number, 0.5)
    memory              = optional(string, "1Gi")
    min_replicas        = optional(number, 1)
    max_replicas        = optional(number, 3)
    concurrent_requests = optional(number, 80)
    revision_mode       = optional(string, "Multiple")
    env                 = optional(map(string), {})
    secret_env          = optional(map(string), {})
  })
}

variable "cms" {
  description = "Payload CMS (ingress external :3001, volume Azure Files cho media)"
  type = object({
    image               = string
    cpu                 = optional(number, 0.5)
    memory              = optional(string, "1Gi")
    min_replicas        = optional(number, 1)
    max_replicas        = optional(number, 1)
    concurrent_requests = optional(number, 30)
    revision_mode       = optional(string, "Multiple")
    env                 = optional(map(string), {})
    secret_env          = optional(map(string), {})
  })
}

variable "cms_media" {
  description = "Azure Files cho upload của Payload (CMS_MEDIA_DIR=/app/media)"
  type = object({
    storage_account_name = string
    share_quota_gb       = optional(number, 20)
  })

  validation {
    condition     = can(regex("^[a-z0-9]{3,24}$", var.cms_media.storage_account_name))
    error_message = "cms_media.storage_account_name chỉ gồm chữ thường/số, 3–24 ký tự."
  }
}

# --- Jobs ------------------------------------------------------------------------------

variable "migrate_secret_env" {
  description = "Secret env cho job migrate (node migrate.mjs trong image api)"
  type        = map(string)
  default = {
    DATABASE_URL_MIGRATE = "database-url-migrate"
  }
}

variable "dbtools_secret_env" {
  description = "Secret env cho job dbtools (psql chạy SQL tạo vai trò app không BYPASSRLS)"
  type        = map(string)
  default = {
    DATABASE_URL_MIGRATE = "database-url-migrate"
    BOOTSTRAP_SQL        = "db-bootstrap-sql"
  }
}

variable "dbtools_image" {
  description = "Image có psql (Docker Hub public, không cần registry credentials)"
  type        = string
  default     = "postgres:16-alpine"
}

# --- OpenTelemetry Collector (ADR-0015) ----------------------------------------------

variable "otel_collector" {
  description = "Collector nội bộ nhận OTLP/HTTP từ api/worker và đẩy sang Application Insights"
  type = object({
    enabled                       = optional(bool, false)
    image                         = optional(string, "otel/opentelemetry-collector-contrib:0.120.0")
    connection_string_secret_name = optional(string, "applicationinsights-connection-string")
  })
  default = {}
}

# --- Custom domain (Cloudflare proxied → Origin CA certificate) -----------------------

variable "custom_domains" {
  description = "Map app (api|web|cms) → hostname công khai. Rỗng = chỉ dùng FQDN *.azurecontainerapps.io"
  type        = map(string)
  default     = {}

  validation {
    condition     = alltrue([for k in keys(var.custom_domains) : contains(["api", "web", "cms"], k)])
    error_message = "custom_domains chỉ nhận khoá api, web, cms."
  }
}

variable "custom_domain_certificate_pfx_base64" {
  description = "Chứng chỉ Cloudflare Origin CA (PFX, base64) cho các hostname trong custom_domains"
  type        = string
  default     = ""
  sensitive   = true
}

variable "custom_domain_certificate_password" {
  type      = string
  default   = ""
  sensitive = true
}

variable "custom_domain_dns_record_ids" {
  description = "ID bản ghi DNS (CNAME + TXT asuid) – chỉ để Terraform tạo binding sau khi DNS đã có (module dns: record_ids)"
  type        = list(string)
  default     = []
}

variable "tags" {
  type    = map(string)
  default = {}
}
