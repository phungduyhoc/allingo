output "id" {
  value = azurerm_redis_cache.this.id
}

output "hostname" {
  value = azurerm_redis_cache.this.hostname
}

output "ssl_port" {
  value = azurerm_redis_cache.this.ssl_port
}

# ioredis/BullMQ: scheme rediss:// tự bật TLS
output "connection_url" {
  value     = "rediss://:${urlencode(azurerm_redis_cache.this.primary_access_key)}@${azurerm_redis_cache.this.hostname}:${azurerm_redis_cache.this.ssl_port}"
  sensitive = true
}
