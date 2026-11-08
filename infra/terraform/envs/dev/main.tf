# =============================================================================
# Allingo – một môi trường trên phương án B (ADR-0023): Azure Container Apps (Southeast Asia) + Cloudflare R2/DNS/WAF.
# TỆP NÀY GIỐNG HỆT envs/dev/main.tf – khác biệt giữa môi trường chỉ nằm ở variables.tf (mặc định) và terraform.tfvars.
#
# Thứ tự phụ thuộc chính:
#   network → postgres, redis │ observability │ storage (R2)
#   → secrets (Key Vault + identity, nạp chuỗi kết nối/khoá sinh ra ở trên)
#   → compute (environment, api/worker/web/cms, jobs) → search (Meilisearch trong environment)
#   → cdn-waf, dns (Cloudflare, khi enable_cloudflare) → custom domain binding (trong compute)
# =============================================================================

locals {
  name_prefix = "${var.project}-${var.environment}"
  short_env   = { dev = "dev", staging = "stg" }[var.environment]
  # APP_ENV của apps/api chỉ nhận development|test|staging|production
  app_env = { dev = "development", staging = "staging" }[var.environment]

  tags = merge({
    project     = var.project
    environment = var.environment
    managed_by  = "terraform"
    adr         = "0023"
  }, var.tags)

  # Tên duy nhất toàn cầu (Key Vault, storage account): hậu tố ngẫu nhiên cố định trong state
  key_vault_name             = "kv-${var.project}-${local.short_env}-${random_string.suffix.result}"
  meili_storage_account_name = "st${var.project}${local.short_env}meili${random_string.suffix.result}"
  cms_storage_account_name   = "st${var.project}${local.short_env}cms${random_string.suffix.result}"
  meili_app_name             = "${local.name_prefix}-meili"

  image_prefix = "${var.image_registry}/${lower(var.image_owner)}/${var.project}"
  images = {
    api = "${local.image_prefix}-api:${var.image_tag}"
    web = "${local.image_prefix}-web:${var.image_tag}${var.web_image_tag_suffix}"
    cms = "${local.image_prefix}-cms:${var.image_tag}"
  }

  # Hostname công khai: Cloudflare (một cấp dưới zone để Universal SSL phủ) hoặc FQDN mặc định của Container Apps.
  # FQDN mặc định dựng từ tên app + default_domain (không tham chiếu tài nguyên app → không tạo vòng phụ thuộc
  # khi chính app cần URL công khai của mình trong env).
  cloudflare_hostnames = {
    web   = "app${var.dns_name_suffix}.${var.cloudflare_zone_name}"
    api   = "api${var.dns_name_suffix}.${var.cloudflare_zone_name}"
    cms   = "cms${var.dns_name_suffix}.${var.cloudflare_zone_name}"
    media = "media${var.dns_name_suffix}.${var.cloudflare_zone_name}"
  }
  aca_hostnames = {
    for k in ["web", "api", "cms"] : k => "${module.compute.app_names[k]}.${module.compute.environment_default_domain}"
  }
  public_hosts = {
    for k in ["web", "api", "cms"] : k => var.enable_cloudflare ? local.cloudflare_hostnames[k] : local.aca_hostnames[k]
  }
  public_urls = { for k, h in local.public_hosts : k => "https://${h}" }
}

resource "random_string" "suffix" {
  length  = 4
  upper   = false
  lower   = true
  numeric = true
  special = false
}

resource "azurerm_resource_group" "this" {
  name     = coalesce(var.resource_group_name, "${local.name_prefix}-rg")
  location = var.location
  tags     = local.tags
}

# =============================================================================
# Mạng, quan sát, dữ liệu
# =============================================================================
module "network" {
  source = "../../modules/network"

  name_prefix                     = local.name_prefix
  location                        = var.location
  resource_group_name             = azurerm_resource_group.this.name
  address_space                   = var.vnet_address_space
  aca_subnet_prefix               = var.aca_subnet_prefix
  postgres_subnet_prefix          = var.postgres_subnet_prefix
  private_endpoints_subnet_prefix = var.private_endpoints_subnet_prefix
  tags                            = local.tags
}

module "observability" {
  source = "../../modules/observability"

  name_prefix         = local.name_prefix
  location            = var.location
  resource_group_name = azurerm_resource_group.this.name
  retention_in_days   = var.log_retention_days
  daily_quota_gb      = var.log_daily_quota_gb
  sampling_percentage = var.appinsights_sampling_percentage
  tags                = local.tags

  # S11: alert hạ tầng (DB/Redis) + uptime /v1/health/ready và landing
  alerts_enabled           = var.infra_alerts_enabled
  alert_emails             = var.alert_emails
  alert_webhook_url        = var.alert_webhook_url
  postgres_server_id       = module.postgres.server_id
  postgres_max_connections = var.postgres_max_connections
  redis_id                 = module.redis.id
  uptime_urls              = var.uptime_urls
}

module "postgres" {
  source = "../../modules/postgres"

  name_prefix                  = local.name_prefix
  location                     = var.location
  resource_group_name          = azurerm_resource_group.this.name
  delegated_subnet_id          = module.network.postgres_subnet_id
  private_dns_zone_id          = module.network.postgres_private_dns_zone_id
  sku_name                     = var.postgres_sku_name
  storage_mb                   = var.postgres_storage_mb
  backup_retention_days        = var.postgres_backup_retention_days
  geo_redundant_backup_enabled = var.postgres_geo_redundant_backup
  high_availability_enabled    = false
  tags                         = local.tags
}

module "redis" {
  source = "../../modules/redis"

  name_prefix                = local.name_prefix
  location                   = var.location
  resource_group_name        = azurerm_resource_group.this.name
  sku_name                   = var.redis_sku_name
  family                     = "C"
  capacity                   = var.redis_capacity
  private_endpoint_subnet_id = module.network.private_endpoints_subnet_id
  private_dns_zone_id        = module.network.redis_private_dns_zone_id
  tags                       = local.tags
}

module "storage" {
  source = "../../modules/storage"

  name_prefix            = local.name_prefix
  cloudflare_account_id  = var.cloudflare_account_id
  cloudflare_zone_id     = var.cloudflare_zone_id
  cors_origins           = [local.public_urls.web, local.public_urls.cms]
  media_public_domain    = var.enable_cloudflare ? local.cloudflare_hostnames.media : null
  recordings_expire_days = 90  # CLAUDE.md §9
  exports_expire_days    = 365 # CLAUDE.md §9
  create_api_token       = var.r2_create_api_token
  s3_access_key_id       = var.r2_access_key_id
  s3_secret_access_key   = var.r2_secret_access_key
}

# =============================================================================
# Secret: sinh ngẫu nhiên + chuỗi kết nối → Key Vault (Container Apps đọc qua managed identity)
# =============================================================================
resource "random_password" "auth_secret" {
  length  = 48
  special = false
}

resource "random_password" "payload_secret" {
  length  = 48
  special = false
}

resource "random_password" "internal_api_token" {
  length  = 40
  special = false
}

resource "random_password" "meili_master_key" {
  length  = 40
  special = false
}

locals {
  # Tên Key Vault secret = tên ENV viết thường, gạch ngang (DATABASE_URL → database-url). Bảng đầy đủ:
  # docs/runbooks/secrets.md. Secret bên thứ ba KHÔNG nằm ở đây (đặt tay, tham chiếu qua external_secret_env).
  kv_secrets = merge(
    {
      "database-url"                          = module.postgres.app_connection_string
      "database-url-migrate"                  = module.postgres.admin_connection_string
      "db-bootstrap-sql"                      = module.postgres.bootstrap_roles_sql
      "redis-url"                             = module.redis.connection_url
      "meilisearch-api-key"                   = random_password.meili_master_key.result
      "s3-access-key-id"                      = module.storage.s3_access_key_id
      "s3-secret-access-key"                  = module.storage.s3_secret_access_key
      "auth-secret"                           = random_password.auth_secret.result
      "payload-secret"                        = random_password.payload_secret.result
      "internal-api-token"                    = random_password.internal_api_token.result
      "applicationinsights-connection-string" = module.observability.app_insights_connection_string
    },
    # Lọc bằng for…if thay vì `cond ? {} : {...}` (tránh lỗi kiểu không khớp giữa hai object literal)
    { for k, v in { "ghcr-pull-token" = var.ghcr_pull_token } : k => v if var.ghcr_username != null },
  )
}

module "secrets" {
  source = "../../modules/secrets"

  name_prefix              = local.name_prefix
  location                 = var.location
  resource_group_name      = azurerm_resource_group.this.name
  key_vault_name           = local.key_vault_name
  purge_protection_enabled = var.key_vault_purge_protection
  secrets                  = local.kv_secrets
  tags                     = local.tags
}

locals {
  # Tham chiếu versionless: secret do Terraform ghi + secret bên thứ ba đặt tay (ID dựng từ URI vault, không đọc giá trị)
  secret_refs = merge(
    module.secrets.secret_ids,
    { for env_name, kv_name in var.external_secret_env : kv_name => "${module.secrets.key_vault_uri}secrets/${kv_name}" },
  )

  # ---- api + worker ------------------------------------------------------------------
  api_env = merge(
    {
      APP_ENV                      = local.app_env
      LOG_LEVEL                    = var.log_level
      TZ                           = "Asia/Ho_Chi_Minh"
      DB_POOL_MAX                  = tostring(var.db_pool_max)
      QUEUE_PREFIX                 = "allingo"
      S3_ENDPOINT                  = module.storage.s3_endpoint
      S3_REGION                    = "auto"
      S3_BUCKET_MEDIA              = module.storage.bucket_names["media"]
      S3_BUCKET_RECORDINGS         = module.storage.bucket_names["recordings"]
      S3_FORCE_PATH_STYLE          = "true"
      S3_PRESIGN_TTL_SECONDS       = "600"
      MEILISEARCH_HOST             = "http://${local.meili_app_name}"
      API_PORT                     = "4000"
      API_HOST                     = "0.0.0.0"
      API_PUBLIC_URL               = local.public_urls.api
      WEB_PUBLIC_URL               = local.public_urls.web
      CMS_PUBLIC_URL               = local.public_urls.cms
      CORS_ORIGINS                 = join(",", [local.public_urls.web, local.public_urls.cms])
      TRUST_PROXY                  = "true"
      RATE_LIMIT_MAX               = "300"
      AUTH_BASE_URL                = "${local.public_urls.api}/v1/auth"
      COOKIE_SECURE                = "true"
      OTP_SENDER                   = "auto"
      OAUTH_MOCK                   = "false"
      SMTP_HOST                    = var.smtp_host
      SMTP_PORT                    = tostring(var.smtp_port)
      SMTP_USER                    = var.smtp_user
      SMTP_FROM                    = var.smtp_from
      AI_PROVIDER                  = var.ai_provider
      AI_TRACE_CONTENT             = "false" # CLAUDE.md §9: không ghi nội dung bài làm vào trace
      ALLOW_UNEVALUATED_ACTIVATION = var.environment == "dev" ? "true" : "false"
      SPEECH_PROVIDER              = var.speech_provider
      AZURE_SPEECH_REGION          = var.location
      PAYMENT_PROVIDERS            = "mock"
      OTEL_ENABLED                 = var.otel_collector_enabled ? "true" : "false"
      OTEL_EXPORTER_OTLP_ENDPOINT  = coalesce(module.compute.otel_internal_endpoint, "http://localhost:4318")
      OTEL_SERVICE_NAME            = "allingo-api"
    },
    { for k, v in { S3_PUBLIC_BASE_URL = module.storage.media_public_base_url } : k => v if v != "" },
    var.api_extra_env,
  )

  api_secret_env = merge(
    {
      DATABASE_URL         = "database-url" # vai trò allingo_app (không BYPASSRLS) – có hiệu lực sau job dbtools
      REDIS_URL            = "redis-url"
      MEILISEARCH_API_KEY  = "meilisearch-api-key"
      S3_ACCESS_KEY_ID     = "s3-access-key-id"
      S3_SECRET_ACCESS_KEY = "s3-secret-access-key"
      AUTH_SECRET          = "auth-secret"
      INTERNAL_API_TOKEN   = "internal-api-token"
    },
    var.external_secret_env,
  )

  # ---- cms --------------------------------------------------------------------------
  cms_env = merge(
    {
      NODE_ENV            = "production"
      TZ                  = "Asia/Ho_Chi_Minh"
      CMS_DATABASE_SCHEMA = "cms"
      CMS_PUBLIC_URL      = local.public_urls.cms
      # Gọi API qua mạng nội bộ environment (không qua Cloudflare – WAF chặn /v1/internal/* từ Internet)
      INTERNAL_API_URL = "http://${module.compute.app_names.api}/v1"
    },
    var.cms_extra_env,
  )

  cms_secret_env = {
    DATABASE_URL       = "database-url"
    PAYLOAD_SECRET     = "payload-secret"
    INTERNAL_API_TOKEN = "internal-api-token"
  }

  # ---- ingress: chỉ Cloudflare (+ subnet ACA cho lưu lượng nội bộ) ---------------------
  ingress_allowed_cidrs = var.enable_cloudflare && var.restrict_ingress_to_cloudflare ? concat(
    module.cdn_waf[0].cloudflare_ipv4_cidrs,
    [var.aca_subnet_prefix],
    var.extra_ingress_allowed_cidrs,
  ) : []
}

# =============================================================================
# Compute (Container Apps) + Meilisearch
# =============================================================================
module "compute" {
  source = "../../modules/compute"

  name_prefix                = local.name_prefix
  location                   = var.location
  resource_group_name        = azurerm_resource_group.this.name
  infrastructure_subnet_id   = module.network.aca_subnet_id
  log_analytics_workspace_id = module.observability.log_analytics_workspace_id
  identity_id                = module.secrets.identity_id
  secret_refs                = local.secret_refs
  ingress_allowed_cidrs      = local.ingress_allowed_cidrs

  registry = {
    server               = var.image_registry
    username             = var.ghcr_username
    password_secret_name = var.ghcr_username == null ? null : "ghcr-pull-token"
  }

  api = {
    image        = local.images.api
    cpu          = var.app_scale["api"].cpu
    memory       = var.app_scale["api"].memory
    min_replicas = var.app_scale["api"].min_replicas
    max_replicas = var.app_scale["api"].max_replicas
    env          = local.api_env
    secret_env   = local.api_secret_env
  }

  worker = {
    cpu          = var.app_scale["worker"].cpu
    memory       = var.app_scale["worker"].memory
    min_replicas = var.app_scale["worker"].min_replicas
    max_replicas = var.app_scale["worker"].max_replicas
    env          = merge(local.api_env, { OTEL_SERVICE_NAME = "allingo-worker" })
    secret_env   = local.api_secret_env
  }

  web = {
    image        = local.images.web
    cpu          = var.app_scale["web"].cpu
    memory       = var.app_scale["web"].memory
    min_replicas = var.app_scale["web"].min_replicas
    max_replicas = var.app_scale["web"].max_replicas
    env          = merge({ TZ = "Asia/Ho_Chi_Minh" }, var.web_extra_env)
  }

  cms = {
    image        = local.images.cms
    cpu          = var.app_scale["cms"].cpu
    memory       = var.app_scale["cms"].memory
    min_replicas = var.app_scale["cms"].min_replicas
    max_replicas = var.app_scale["cms"].max_replicas
    env          = local.cms_env
    secret_env   = local.cms_secret_env
  }

  cms_media = {
    storage_account_name = local.cms_storage_account_name
  }

  otel_collector = {
    enabled = var.otel_collector_enabled
  }

  custom_domains                       = { for k in ["web", "api", "cms"] : k => local.cloudflare_hostnames[k] if var.enable_cloudflare }
  custom_domain_certificate_pfx_base64 = var.origin_certificate_pfx_base64
  custom_domain_certificate_password   = var.origin_certificate_password
  custom_domain_dns_record_ids         = var.enable_cloudflare ? module.dns[0].record_ids : []

  tags = local.tags
}

module "search" {
  source = "../../modules/search"

  app_name                     = local.meili_app_name
  location                     = var.location
  resource_group_name          = azurerm_resource_group.this.name
  container_app_environment_id = module.compute.environment_id
  storage_account_name         = local.meili_storage_account_name
  master_key                   = random_password.meili_master_key.result
  cpu                          = var.meili_cpu
  memory                       = var.meili_memory
  max_indexing_memory          = var.meili_max_indexing_memory
  tags                         = local.tags
}

# =============================================================================
# Cloudflare edge (tuỳ chọn)
# =============================================================================
module "cdn_waf" {
  count  = var.enable_cloudflare ? 1 : 0
  source = "../../modules/cdn-waf"

  name_prefix          = local.name_prefix
  zone_id              = var.cloudflare_zone_id
  manage_zone_settings = var.cloudflare_manage_zone_settings
  manage_waf           = var.cloudflare_manage_waf

  hosts = {
    api = concat([local.cloudflare_hostnames.api], lookup(var.cloudflare_waf_extra_hosts, "api", []))
    web = concat([local.cloudflare_hostnames.web], lookup(var.cloudflare_waf_extra_hosts, "web", []))
    cms = concat([local.cloudflare_hostnames.cms], lookup(var.cloudflare_waf_extra_hosts, "cms", []))
  }

  admin_allowed_countries = var.admin_allowed_countries
  admin_allowed_ips       = var.admin_allowed_ips
  auth_rate_limit         = var.auth_rate_limit
  # S11: rate limit OTP/webhook (gói Pro+) + allowlist IP webhook theo cổng
  extra_rate_limits    = var.extra_rate_limits
  webhook_ip_allowlist = var.webhook_ip_allowlist
}

module "dns" {
  count  = var.enable_cloudflare ? 1 : 0
  source = "../../modules/dns"

  zone_id         = var.cloudflare_zone_id
  proxied         = var.cloudflare_proxied
  verification_id = module.compute.custom_domain_verification_id
  comment         = "${local.name_prefix} (terraform)"

  records = {
    web = { name = local.cloudflare_hostnames.web, target = module.compute.fqdns.web }
    api = { name = local.cloudflare_hostnames.api, target = module.compute.fqdns.api }
    cms = { name = local.cloudflare_hostnames.cms, target = module.compute.fqdns.cms }
  }
}
