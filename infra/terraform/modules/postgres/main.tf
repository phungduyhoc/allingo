# Azure Database for PostgreSQL Flexible Server 16, chỉ truy cập trong VNet (delegated subnet + private DNS).
# Extension vector/citext/pg_trgm/pg_stat_statements được allowlist qua tham số `azure.extensions`;
# `CREATE EXTENSION` thực sự chạy trong migration 0001 (db/drizzle/migrations).
#
# Hai vai trò DB (CLAUDE.md §5.10 – vai trò runtime KHÔNG BYPASSRLS):
#   - admin (administrator_login): DATABASE_URL_MIGRATE – chạy migration, tạo schema/extension
#   - allingo_app (tạo bằng scripts/bootstrap-db-roles.sql qua Container Apps Job `dbtools`): DATABASE_URL
# Terraform không mở kết nối SQL tới server (server nằm trong VNet), nên vai trò app được tạo bằng job.

resource "random_password" "admin" {
  length  = 32
  special = false
}

resource "random_password" "app" {
  length  = 32
  special = false
}

resource "azurerm_postgresql_flexible_server" "this" {
  name                          = "${var.name_prefix}-pg"
  location                      = var.location
  resource_group_name           = var.resource_group_name
  version                       = "16"
  delegated_subnet_id           = var.delegated_subnet_id
  private_dns_zone_id           = var.private_dns_zone_id
  public_network_access_enabled = false

  administrator_login    = var.administrator_login
  administrator_password = random_password.admin.result

  sku_name                     = var.sku_name
  storage_mb                   = var.storage_mb
  auto_grow_enabled            = true
  backup_retention_days        = var.backup_retention_days
  geo_redundant_backup_enabled = false
  zone                         = var.availability_zone

  authentication {
    password_auth_enabled         = true
    active_directory_auth_enabled = false
  }

  dynamic "high_availability" {
    for_each = var.high_availability_enabled ? [1] : []
    content {
      mode = "ZoneRedundant"
    }
  }

  maintenance_window {
    day_of_week  = 0  # Chủ nhật
    start_hour   = 19 # 02:00 giờ Việt Nam
    start_minute = 0
  }

  tags = var.tags

  lifecycle {
    # Azure có thể tự đổi zone khi failover; không để Terraform tạo lại server
    ignore_changes = [zone, high_availability[0].standby_availability_zone]
  }
}

# Allowlist extension (tên viết hoa theo tài liệu Azure)
resource "azurerm_postgresql_flexible_server_configuration" "extensions" {
  name      = "azure.extensions"
  server_id = azurerm_postgresql_flexible_server.this.id
  value     = "VECTOR,CITEXT,PG_TRGM,PGCRYPTO,PG_STAT_STATEMENTS"
}

# Tham số tĩnh: cần restart server sau lần apply đầu (az postgres flexible-server restart)
resource "azurerm_postgresql_flexible_server_configuration" "shared_preload_libraries" {
  name      = "shared_preload_libraries"
  server_id = azurerm_postgresql_flexible_server.this.id
  value     = "pg_stat_statements"
}

resource "azurerm_postgresql_flexible_server_configuration" "log_min_duration" {
  name      = "log_min_duration_statement"
  server_id = azurerm_postgresql_flexible_server.this.id
  value     = "500"
}

resource "azurerm_postgresql_flexible_server_database" "app" {
  name      = var.database_name
  server_id = azurerm_postgresql_flexible_server.this.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

locals {
  host = azurerm_postgresql_flexible_server.this.fqdn
  # SQL tạo vai trò runtime (không BYPASSRLS) – chạy một lần bằng job dbtools (xem compute + runbook)
  bootstrap_sql = templatefile("${path.module}/bootstrap-db-roles.sql.tftpl", {
    app_role     = var.app_role_name
    app_password = random_password.app.result
    database     = var.database_name
  })
}
