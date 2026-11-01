# Compute cho phương án B (ADR-0023): Azure Container Apps Environment (workload profile Consumption, VNet)
#   - api     : NestJS/Fastify, ingress external :4000, probe /v1/health/live & /v1/health/ready, scale HTTP
#   - worker  : cùng image api, `node dist/worker.js`, không ingress, min 1 replica
#   - web     : Next.js standalone, ingress external :3000, scale HTTP
#   - cms     : Payload CMS, ingress external :3001, media trên Azure Files
#   - otel    : OpenTelemetry Collector nội bộ (tuỳ chọn) → Application Insights
#   - jobs    : migrate (node migrate.mjs) và dbtools (psql tạo vai trò app) – chạy thủ công/CI
# Meilisearch nằm ở module search (dùng environment_id của module này).
#
# Secret: mọi giá trị nhạy cảm là tham chiếu Key Vault (versionless) đọc bằng user-assigned identity
# (Key Vault Secrets User); Terraform không đặt giá trị secret trực tiếp vào Container App.
#
# Phân vai Terraform ↔ CI:
#   - Terraform sở hữu hạ tầng và cấu hình (env, secret, scale, probe, ingress).
#   - .github/workflows/deploy-staging.yml sở hữu image (`az containerapp update --image`) và traffic giữa revision
#     → lifecycle.ignore_changes trên image / revision_suffix / traffic_weight để `terraform apply` không kéo lùi
#     bản đang chạy. `image` trong biến chỉ dùng khi tạo app lần đầu.

locals {
  names = {
    environment = "${var.name_prefix}-cae"
    api         = "${var.name_prefix}-api"
    worker      = "${var.name_prefix}-worker"
    web         = "${var.name_prefix}-web"
    cms         = "${var.name_prefix}-cms"
    otel        = "${var.name_prefix}-otel"
    migrate     = "${var.name_prefix}-migrate"
    dbtools     = "${var.name_prefix}-dbtools"
  }

  registry_enabled      = var.registry.username != null
  registry_secret_names = local.registry_enabled ? toset([var.registry.password_secret_name]) : toset([])

  api_secret_names     = setunion(toset(values(var.api.secret_env)), local.registry_secret_names)
  worker_secret_names  = setunion(toset(values(var.worker.secret_env)), local.registry_secret_names)
  web_secret_names     = setunion(toset(values(var.web.secret_env)), local.registry_secret_names)
  cms_secret_names     = setunion(toset(values(var.cms.secret_env)), local.registry_secret_names)
  migrate_secret_names = setunion(toset(values(var.migrate_secret_env)), local.registry_secret_names)
  dbtools_secret_names = toset(values(var.dbtools_secret_env))
  otel_secret_names    = var.otel_collector.enabled ? toset([var.otel_collector.connection_string_secret_name]) : toset([])

  all_secret_names = setunion(
    local.api_secret_names, local.worker_secret_names, local.web_secret_names, local.cms_secret_names,
    local.migrate_secret_names, local.dbtools_secret_names, local.otel_secret_names,
  )
  missing_secret_names = setsubtract(local.all_secret_names, keys(var.secret_refs))

  ingress_ip_rules = [
    for i, cidr in var.ingress_allowed_cidrs : {
      name = format("allow-%02d", i)
      cidr = cidr
    }
  ]

  # Next.js standalone đọc HOSTNAME để bind: trên Container Apps (Kubernetes) runtime có thể đặt HOSTNAME = tên pod
  # → ép 0.0.0.0 ở cấp container (ưu tiên hơn ENV trong image)
  next_runtime_env = { HOSTNAME = "0.0.0.0" }

  # Cấu hình collector truyền qua env (otelcol hỗ trợ --config=env:VAR); $${env:...} để Terraform không nội suy
  otel_config = yamlencode({
    receivers = {
      otlp = {
        protocols = {
          http = { endpoint = "0.0.0.0:4318" }
        }
      }
    }
    processors = {
      memory_limiter = { check_interval = "1s", limit_percentage = 80, spike_limit_percentage = 25 }
      batch          = {}
    }
    exporters = {
      azuremonitor = { connection_string = "$${env:APPLICATIONINSIGHTS_CONNECTION_STRING}" }
    }
    extensions = {
      health_check = { endpoint = "0.0.0.0:13133" }
    }
    service = {
      extensions = ["health_check"]
      pipelines = {
        traces  = { receivers = ["otlp"], processors = ["memory_limiter", "batch"], exporters = ["azuremonitor"] }
        metrics = { receivers = ["otlp"], processors = ["memory_limiter", "batch"], exporters = ["azuremonitor"] }
        logs    = { receivers = ["otlp"], processors = ["memory_limiter", "batch"], exporters = ["azuremonitor"] }
      }
    }
  })
}

# =============================================================================
# Container Apps Environment
# =============================================================================
resource "azurerm_container_app_environment" "this" {
  name                               = local.names.environment
  location                           = var.location
  resource_group_name                = var.resource_group_name
  log_analytics_workspace_id         = var.log_analytics_workspace_id
  logs_destination                   = "log-analytics"
  infrastructure_subnet_id           = var.infrastructure_subnet_id
  infrastructure_resource_group_name = "${var.name_prefix}-cae-infra-rg"
  internal_load_balancer_enabled     = false
  zone_redundancy_enabled            = var.zone_redundancy_enabled
  tags                               = var.tags

  # Consumption trong environment kiểu workload profiles (bắt buộc khi gắn VNet + subnet uỷ quyền)
  workload_profile {
    name                  = "Consumption"
    workload_profile_type = "Consumption"
  }
}

# Azure Files cho media của CMS (Payload lưu upload ở CMS_MEDIA_DIR)
resource "azurerm_storage_account" "cms_media" {
  name                            = var.cms_media.storage_account_name
  resource_group_name             = var.resource_group_name
  location                        = var.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  https_traffic_only_enabled      = true
  allow_nested_items_to_be_public = false
  tags                            = var.tags
}

resource "azurerm_storage_share" "cms_media" {
  name               = "cms-media"
  storage_account_id = azurerm_storage_account.cms_media.id
  quota              = var.cms_media.share_quota_gb
}

resource "azurerm_container_app_environment_storage" "cms_media" {
  name                         = "cms-media"
  container_app_environment_id = azurerm_container_app_environment.this.id
  account_name                 = azurerm_storage_account.cms_media.name
  share_name                   = azurerm_storage_share.cms_media.name
  access_key                   = azurerm_storage_account.cms_media.primary_access_key
  access_mode                  = "ReadWrite"
}

# =============================================================================
# api
# =============================================================================
resource "azurerm_container_app" "api" {
  name                         = local.names.api
  container_app_environment_id = azurerm_container_app_environment.this.id
  resource_group_name          = var.resource_group_name
  revision_mode                = var.api.revision_mode
  workload_profile_name        = "Consumption"
  tags                         = var.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [var.identity_id]
  }

  dynamic "secret" {
    for_each = local.api_secret_names
    content {
      name                = secret.value
      key_vault_secret_id = var.secret_refs[secret.value]
      identity            = var.identity_id
    }
  }

  dynamic "registry" {
    for_each = local.registry_enabled ? [var.registry] : []
    content {
      server               = registry.value.server
      username             = registry.value.username
      password_secret_name = registry.value.password_secret_name
    }
  }

  ingress {
    external_enabled           = true
    allow_insecure_connections = var.api_allow_insecure_connections
    target_port                = 4000
    transport                  = "auto" # HTTP/1.1, HTTP/2 và WebSocket (Socket.IO namespace /ws)

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }

    dynamic "ip_security_restriction" {
      for_each = local.ingress_ip_rules
      content {
        name             = ip_security_restriction.value.name
        action           = "Allow"
        ip_address_range = ip_security_restriction.value.cidr
      }
    }
  }

  template {
    min_replicas                     = var.api.min_replicas
    max_replicas                     = var.api.max_replicas
    termination_grace_period_seconds = 30

    container {
      name   = "api"
      image  = var.api.image
      cpu    = var.api.cpu
      memory = var.api.memory

      dynamic "env" {
        for_each = var.api.env
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = var.api.secret_env
        content {
          name        = env.key
          secret_name = env.value
        }
      }

      # Nest khởi động + kết nối DB/Redis: cho tối đa ~50 giây trước khi liveness bắt đầu
      startup_probe {
        transport               = "HTTP"
        port                    = 4000
        path                    = "/v1/health/live"
        interval_seconds        = 5
        timeout                 = 3
        failure_count_threshold = 10
      }

      liveness_probe {
        transport               = "HTTP"
        port                    = 4000
        path                    = "/v1/health/live"
        interval_seconds        = 15
        timeout                 = 3
        failure_count_threshold = 3
      }

      readiness_probe {
        transport               = "HTTP"
        port                    = 4000
        path                    = "/v1/health/ready"
        interval_seconds        = 10
        timeout                 = 5
        failure_count_threshold = 3
        success_count_threshold = 1
      }
    }

    http_scale_rule {
      name                = "http-concurrency"
      concurrent_requests = tostring(var.api.concurrent_requests)
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].container[0].image,
      template[0].revision_suffix,
      ingress[0].traffic_weight,
    ]

    precondition {
      condition     = length(local.missing_secret_names) == 0
      error_message = "Thiếu tham chiếu Key Vault cho secret: ${join(", ", sort(tolist(local.missing_secret_names)))}. Thêm vào secret_refs (envs/*/main.tf) hoặc external_secret_env."
    }
  }
}

# =============================================================================
# worker (BullMQ) – cùng image api, không ingress
# =============================================================================
resource "azurerm_container_app" "worker" {
  name                         = local.names.worker
  container_app_environment_id = azurerm_container_app_environment.this.id
  resource_group_name          = var.resource_group_name
  revision_mode                = "Single"
  workload_profile_name        = "Consumption"
  tags                         = var.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [var.identity_id]
  }

  dynamic "secret" {
    for_each = local.worker_secret_names
    content {
      name                = secret.value
      key_vault_secret_id = var.secret_refs[secret.value]
      identity            = var.identity_id
    }
  }

  dynamic "registry" {
    for_each = local.registry_enabled ? [var.registry] : []
    content {
      server               = registry.value.server
      username             = registry.value.username
      password_secret_name = registry.value.password_secret_name
    }
  }

  template {
    # Không có scale rule: số replica = min_replicas (chưa dùng KEDA redis scaler – xem README)
    min_replicas = var.worker.min_replicas
    max_replicas = max(var.worker.max_replicas, var.worker.min_replicas)
    # Thời gian cho BullMQ hoàn tất job đang chạy sau SIGTERM (tini chuyển tín hiệu cho node)
    termination_grace_period_seconds = var.worker.termination_grace_period_seconds

    container {
      name   = "worker"
      image  = var.api.image
      cpu    = var.worker.cpu
      memory = var.worker.memory
      # Ghi đè CMD của apps/api/Dockerfile, giữ ENTRYPOINT tini
      args = ["node", "dist/worker.js"]

      dynamic "env" {
        for_each = merge(var.worker.env, { APP_ENTRY = "dist/worker.js" })
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = var.worker.secret_env
        content {
          name        = env.key
          secret_name = env.value
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].container[0].image,
      template[0].revision_suffix,
    ]
  }
}

# =============================================================================
# web (Next.js standalone)
# =============================================================================
resource "azurerm_container_app" "web" {
  name                         = local.names.web
  container_app_environment_id = azurerm_container_app_environment.this.id
  resource_group_name          = var.resource_group_name
  revision_mode                = var.web.revision_mode
  workload_profile_name        = "Consumption"
  tags                         = var.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [var.identity_id]
  }

  dynamic "secret" {
    for_each = local.web_secret_names
    content {
      name                = secret.value
      key_vault_secret_id = var.secret_refs[secret.value]
      identity            = var.identity_id
    }
  }

  dynamic "registry" {
    for_each = local.registry_enabled ? [var.registry] : []
    content {
      server               = registry.value.server
      username             = registry.value.username
      password_secret_name = registry.value.password_secret_name
    }
  }

  ingress {
    external_enabled           = true
    allow_insecure_connections = false
    target_port                = 3000
    transport                  = "auto"

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }

    dynamic "ip_security_restriction" {
      for_each = local.ingress_ip_rules
      content {
        name             = ip_security_restriction.value.name
        action           = "Allow"
        ip_address_range = ip_security_restriction.value.cidr
      }
    }
  }

  template {
    min_replicas = var.web.min_replicas
    max_replicas = var.web.max_replicas

    container {
      name   = "web"
      image  = var.web.image
      cpu    = var.web.cpu
      memory = var.web.memory

      dynamic "env" {
        for_each = merge(var.web.env, local.next_runtime_env, { PORT = "3000" })
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = var.web.secret_env
        content {
          name        = env.key
          secret_name = env.value
        }
      }

      startup_probe {
        transport               = "TCP"
        port                    = 3000
        interval_seconds        = 3
        failure_count_threshold = 10
      }

      liveness_probe {
        transport               = "TCP"
        port                    = 3000
        interval_seconds        = 15
        failure_count_threshold = 3
      }

      # Route tĩnh (app/manifest.ts) – không qua proxy next-intl, không gọi API → web không "unready" khi API lỗi
      readiness_probe {
        transport               = "HTTP"
        port                    = 3000
        path                    = "/manifest.webmanifest"
        interval_seconds        = 10
        timeout                 = 5
        failure_count_threshold = 3
        success_count_threshold = 1
      }
    }

    http_scale_rule {
      name                = "http-concurrency"
      concurrent_requests = tostring(var.web.concurrent_requests)
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].container[0].image,
      template[0].revision_suffix,
      ingress[0].traffic_weight,
    ]
  }
}

# =============================================================================
# cms (Payload CMS)
# =============================================================================
resource "azurerm_container_app" "cms" {
  name                         = local.names.cms
  container_app_environment_id = azurerm_container_app_environment.this.id
  resource_group_name          = var.resource_group_name
  revision_mode                = var.cms.revision_mode
  workload_profile_name        = "Consumption"
  tags                         = var.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [var.identity_id]
  }

  dynamic "secret" {
    for_each = local.cms_secret_names
    content {
      name                = secret.value
      key_vault_secret_id = var.secret_refs[secret.value]
      identity            = var.identity_id
    }
  }

  dynamic "registry" {
    for_each = local.registry_enabled ? [var.registry] : []
    content {
      server               = registry.value.server
      username             = registry.value.username
      password_secret_name = registry.value.password_secret_name
    }
  }

  ingress {
    external_enabled           = true
    allow_insecure_connections = false
    target_port                = 3001
    transport                  = "auto"

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }

    dynamic "ip_security_restriction" {
      for_each = local.ingress_ip_rules
      content {
        name             = ip_security_restriction.value.name
        action           = "Allow"
        ip_address_range = ip_security_restriction.value.cidr
      }
    }
  }

  template {
    min_replicas = var.cms.min_replicas
    max_replicas = var.cms.max_replicas

    container {
      name   = "cms"
      image  = var.cms.image
      cpu    = var.cms.cpu
      memory = var.cms.memory

      dynamic "env" {
        for_each = merge(var.cms.env, local.next_runtime_env, { CMS_PORT = "3001", CMS_MEDIA_DIR = "/app/media" })
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = var.cms.secret_env
        content {
          name        = env.key
          secret_name = env.value
        }
      }

      volume_mounts {
        name = "media"
        path = "/app/media"
      }

      startup_probe {
        transport               = "TCP"
        port                    = 3001
        interval_seconds        = 6
        failure_count_threshold = 10
      }

      liveness_probe {
        transport               = "TCP"
        port                    = 3001
        interval_seconds        = 20
        failure_count_threshold = 3
      }

      # Trang đăng nhập admin: Payload đã khởi tạo + kết nối DB
      readiness_probe {
        transport               = "HTTP"
        port                    = 3001
        path                    = "/admin/login"
        interval_seconds        = 15
        timeout                 = 10
        failure_count_threshold = 3
        success_count_threshold = 1
      }
    }

    volume {
      name         = "media"
      storage_name = azurerm_container_app_environment_storage.cms_media.name
      storage_type = "AzureFile"
      # Image chạy user `node` (uid/gid 1000); nobrl tránh lỗi khoá byte-range trên SMB
      mount_options = "uid=1000,gid=1000,dir_mode=0750,file_mode=0640,nobrl"
    }

    http_scale_rule {
      name                = "http-concurrency"
      concurrent_requests = tostring(var.cms.concurrent_requests)
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].container[0].image,
      template[0].revision_suffix,
      ingress[0].traffic_weight,
    ]
  }
}

# =============================================================================
# OpenTelemetry Collector (nội bộ) – api/worker gửi OTLP/HTTP tới http://<prefix>-otel
# =============================================================================
resource "azurerm_container_app" "otel" {
  count = var.otel_collector.enabled ? 1 : 0

  name                         = local.names.otel
  container_app_environment_id = azurerm_container_app_environment.this.id
  resource_group_name          = var.resource_group_name
  revision_mode                = "Single"
  workload_profile_name        = "Consumption"
  tags                         = var.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [var.identity_id]
  }

  dynamic "secret" {
    for_each = local.otel_secret_names
    content {
      name                = secret.value
      key_vault_secret_id = var.secret_refs[secret.value]
      identity            = var.identity_id
    }
  }

  ingress {
    external_enabled = false
    target_port      = 4318
    transport        = "http"

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = 1
    max_replicas = 1

    container {
      name   = "otel-collector"
      image  = var.otel_collector.image
      cpu    = 0.25
      memory = "0.5Gi"
      args   = ["--config=env:OTEL_CONFIG"]

      env {
        name  = "OTEL_CONFIG"
        value = local.otel_config
      }

      env {
        name        = "APPLICATIONINSIGHTS_CONNECTION_STRING"
        secret_name = var.otel_collector.connection_string_secret_name
      }

      liveness_probe {
        transport               = "HTTP"
        port                    = 13133
        path                    = "/"
        interval_seconds        = 30
        failure_count_threshold = 3
      }

      readiness_probe {
        transport               = "HTTP"
        port                    = 13133
        path                    = "/"
        interval_seconds        = 15
        failure_count_threshold = 3
      }
    }
  }
}

# =============================================================================
# Jobs (trigger thủ công: `az containerapp job start`) – chạy trong VNet nên tới được Postgres private
# =============================================================================
resource "azurerm_container_app_job" "migrate" {
  name                         = local.names.migrate
  location                     = var.location
  resource_group_name          = var.resource_group_name
  container_app_environment_id = azurerm_container_app_environment.this.id
  workload_profile_name        = "Consumption"
  replica_timeout_in_seconds   = 900
  replica_retry_limit          = 0 # migration không tự chạy lại; lỗi → xử lý theo docs/runbooks/deploy-staging.md
  tags                         = var.tags

  manual_trigger_config {
    parallelism              = 1
    replica_completion_count = 1
  }

  identity {
    type         = "UserAssigned"
    identity_ids = [var.identity_id]
  }

  dynamic "secret" {
    for_each = local.migrate_secret_names
    content {
      name                = secret.value
      key_vault_secret_id = var.secret_refs[secret.value]
      identity            = var.identity_id
    }
  }

  dynamic "registry" {
    for_each = local.registry_enabled ? [var.registry] : []
    content {
      server               = registry.value.server
      username             = registry.value.username
      password_secret_name = registry.value.password_secret_name
    }
  }

  template {
    container {
      name   = "migrate"
      image  = var.api.image
      cpu    = 0.5
      memory = "1Gi"
      # /app/migrate.mjs (infra/docker/migrate.mjs) – drizzle migrator, đọc DATABASE_URL_MIGRATE
      args = ["node", "migrate.mjs"]

      env {
        name  = "NODE_ENV"
        value = "production"
      }

      dynamic "env" {
        for_each = var.migrate_secret_env
        content {
          name        = env.key
          secret_name = env.value
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].container[0].image]
  }
}

resource "azurerm_container_app_job" "dbtools" {
  name                         = local.names.dbtools
  location                     = var.location
  resource_group_name          = var.resource_group_name
  container_app_environment_id = azurerm_container_app_environment.this.id
  workload_profile_name        = "Consumption"
  replica_timeout_in_seconds   = 300
  replica_retry_limit          = 0
  tags                         = var.tags

  manual_trigger_config {
    parallelism              = 1
    replica_completion_count = 1
  }

  identity {
    type         = "UserAssigned"
    identity_ids = [var.identity_id]
  }

  dynamic "secret" {
    for_each = local.dbtools_secret_names
    content {
      name                = secret.value
      key_vault_secret_id = var.secret_refs[secret.value]
      identity            = var.identity_id
    }
  }

  template {
    container {
      name   = "dbtools"
      image  = var.dbtools_image
      cpu    = 0.25
      memory = "0.5Gi"
      # Chạy SQL tạo/cập nhật vai trò allingo_app (modules/postgres/bootstrap-db-roles.sql.tftpl); idempotent.
      # --quiet: không in câu lệnh (chứa mật khẩu) ra log.
      command = ["/bin/sh", "-c"]
      args    = ["printf '%s' \"$BOOTSTRAP_SQL\" | psql \"$DATABASE_URL_MIGRATE\" -v ON_ERROR_STOP=1 --quiet --no-psqlrc && echo 'bootstrap roles: OK'"]

      dynamic "env" {
        for_each = var.dbtools_secret_env
        content {
          name        = env.key
          secret_name = env.value
        }
      }
    }
  }
}

# =============================================================================
# Custom domain: chứng chỉ Cloudflare Origin CA (Cloudflare SSL "Full (strict)") + binding SNI
# =============================================================================
resource "azurerm_container_app_environment_certificate" "origin" {
  count = length(var.custom_domains) > 0 ? 1 : 0

  name                         = "${var.name_prefix}-cf-origin"
  container_app_environment_id = azurerm_container_app_environment.this.id
  certificate_blob_base64      = var.custom_domain_certificate_pfx_base64
  certificate_password         = var.custom_domain_certificate_password
  tags                         = var.tags

  lifecycle {
    precondition {
      condition     = nonsensitive(length(var.custom_domain_certificate_pfx_base64) > 0)
      error_message = "custom_domains khác rỗng nhưng thiếu custom_domain_certificate_pfx_base64 (xem docs/runbooks/secrets.md – Origin CA)."
    }
  }
}

# Binding chỉ tạo sau khi CNAME + TXT asuid đã có trên Cloudflare (Azure kiểm tra quyền sở hữu domain)
resource "terraform_data" "custom_domain_dns" {
  count = length(var.custom_domains) > 0 ? 1 : 0
  input = var.custom_domain_dns_record_ids
}

locals {
  ingress_app_ids = {
    api = azurerm_container_app.api.id
    web = azurerm_container_app.web.id
    cms = azurerm_container_app.cms.id
  }
}

resource "azurerm_container_app_custom_domain" "this" {
  for_each = var.custom_domains

  name                                     = each.value
  container_app_id                         = local.ingress_app_ids[each.key]
  container_app_environment_certificate_id = azurerm_container_app_environment_certificate.origin[0].id
  certificate_binding_type                 = "SniEnabled"

  depends_on = [terraform_data.custom_domain_dns]
}
