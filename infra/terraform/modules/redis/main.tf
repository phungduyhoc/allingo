# Azure Cache for Redis (Basic/Standard), chỉ private endpoint trong VNet, TLS bắt buộc (cổng 6380, rediss://).
# Lựa chọn thay vì Azure Managed Redis (ADR-0023): tier Basic C0/Standard C1 rẻ hơn ở quy mô dev/staging,
# BullMQ chỉ cần Redis 6+ với maxmemory-policy=noeviction. Chuyển sang Azure Managed Redis khi cần
# >6 GB hoặc SLA cao hơn; API chỉ đổi REDIS_URL.

resource "azurerm_redis_cache" "this" {
  name                          = "${var.name_prefix}-redis"
  location                      = var.location
  resource_group_name           = var.resource_group_name
  capacity                      = var.capacity
  family                        = var.family
  sku_name                      = var.sku_name
  non_ssl_port_enabled          = false
  minimum_tls_version           = "1.2"
  public_network_access_enabled = false
  redis_version                 = "6"

  redis_configuration {
    # BullMQ yêu cầu không evict key của hàng đợi
    maxmemory_policy = "noeviction"
    # S11: persistence RDB (Premium) – docs/runbooks/restore.md §2
    rdb_backup_enabled            = var.rdb_backup != null && var.sku_name == "Premium" ? true : null
    rdb_backup_frequency          = var.rdb_backup != null && var.sku_name == "Premium" ? var.rdb_backup.frequency_minutes : null
    rdb_backup_max_snapshot_count = var.rdb_backup != null && var.sku_name == "Premium" ? var.rdb_backup.max_snapshots : null
    rdb_storage_connection_string = var.rdb_backup != null && var.sku_name == "Premium" ? var.rdb_backup.storage_connection_string : null
  }

  tags = var.tags
}

resource "azurerm_private_endpoint" "this" {
  name                = "${var.name_prefix}-redis-pe"
  location            = var.location
  resource_group_name = var.resource_group_name
  subnet_id           = var.private_endpoint_subnet_id
  tags                = var.tags

  private_service_connection {
    name                           = "${var.name_prefix}-redis-psc"
    private_connection_resource_id = azurerm_redis_cache.this.id
    is_manual_connection           = false
    subresource_names              = ["redisCache"]
  }

  private_dns_zone_group {
    name                 = "default"
    private_dns_zone_ids = [var.private_dns_zone_id]
  }
}
