output "vnet_id" {
  value = azurerm_virtual_network.this.id
}

output "aca_subnet_id" {
  value = azurerm_subnet.aca.id
}

output "postgres_subnet_id" {
  value = azurerm_subnet.postgres.id
}

output "private_endpoints_subnet_id" {
  value = azurerm_subnet.private_endpoints.id
}

# depends_on: Flexible Server yêu cầu private DNS zone đã link vào VNet trước khi tạo server
output "postgres_private_dns_zone_id" {
  value      = azurerm_private_dns_zone.postgres.id
  depends_on = [azurerm_private_dns_zone_virtual_network_link.postgres]
}

output "redis_private_dns_zone_id" {
  value      = azurerm_private_dns_zone.redis.id
  depends_on = [azurerm_private_dns_zone_virtual_network_link.redis]
}

output "aca_subnet_prefix" {
  value = var.aca_subnet_prefix
}
