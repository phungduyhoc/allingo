# Meilisearch chạy như Container App nội bộ (1 replica, không scale-to-zero), dữ liệu trên Azure Files (SMB).
# Ingress internal: api/worker gọi http://<tên app> trong cùng Container Apps Environment.
#
# RỦI RO đã biết: Meilisearch (LMDB) không khuyến nghị chạy trên SMB/NFS; với chỉ mục nhỏ (dev/staging) chấp nhận được,
# index có thể dựng lại từ Postgres (outbox relay). Prod cân nhắc Meilisearch Cloud hoặc VM có managed disk (ADR-0023).

resource "azurerm_storage_account" "meili" {
  name                            = var.storage_account_name
  resource_group_name             = var.resource_group_name
  location                        = var.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  https_traffic_only_enabled      = true
  allow_nested_items_to_be_public = false
  tags                            = var.tags
}

resource "azurerm_storage_share" "meili" {
  name               = "meili-data"
  storage_account_id = azurerm_storage_account.meili.id
  quota              = var.share_quota_gb
}

resource "azurerm_container_app_environment_storage" "meili" {
  name                         = "meili-data"
  container_app_environment_id = var.container_app_environment_id
  account_name                 = azurerm_storage_account.meili.name
  share_name                   = azurerm_storage_share.meili.name
  access_key                   = azurerm_storage_account.meili.primary_access_key
  access_mode                  = "ReadWrite"
}

resource "azurerm_container_app" "meili" {
  name                         = var.app_name
  container_app_environment_id = var.container_app_environment_id
  resource_group_name          = var.resource_group_name
  revision_mode                = "Single"
  workload_profile_name        = "Consumption"
  tags                         = var.tags

  secret {
    name  = "meili-master-key"
    value = var.master_key
  }

  ingress {
    external_enabled = false
    target_port      = 7700
    transport        = "http"

    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }

  template {
    min_replicas = 1
    max_replicas = 1

    container {
      name   = "meilisearch"
      image  = var.image
      cpu    = var.cpu
      memory = var.memory

      env {
        name        = "MEILI_MASTER_KEY"
        secret_name = "meili-master-key"
      }
      env {
        name  = "MEILI_ENV"
        value = "production"
      }
      env {
        name  = "MEILI_NO_ANALYTICS"
        value = "true"
      }
      env {
        name  = "MEILI_DB_PATH"
        value = "/meili_data"
      }
      env {
        name  = "MEILI_MAX_INDEXING_MEMORY"
        value = var.max_indexing_memory
      }

      volume_mounts {
        name = "data"
        path = "/meili_data"
      }

      liveness_probe {
        transport               = "HTTP"
        port                    = 7700
        path                    = "/health"
        interval_seconds        = 15
        failure_count_threshold = 3
        initial_delay           = 10
      }

      readiness_probe {
        transport               = "HTTP"
        port                    = 7700
        path                    = "/health"
        interval_seconds        = 10
        failure_count_threshold = 3
      }
    }

    volume {
      name         = "data"
      storage_name = azurerm_container_app_environment_storage.meili.name
      storage_type = "AzureFile"
    }
  }
}
