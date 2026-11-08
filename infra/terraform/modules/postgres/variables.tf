variable "name_prefix" {
  type = string
}

variable "location" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "delegated_subnet_id" {
  type = string
}

variable "private_dns_zone_id" {
  type = string
}

variable "sku_name" {
  description = "B_Standard_B1ms (dev), B_Standard_B2ms (staging), GP_Standard_D2ds_v5 (prod)"
  type        = string
  default     = "B_Standard_B1ms"
}

variable "storage_mb" {
  type    = number
  default = 32768
}

variable "backup_retention_days" {
  description = "PITR (WAL + backup tự động): 7 dev, 30 staging/prod (S11 – docs/runbooks/restore.md)"
  type        = number
  default     = 7

  validation {
    condition     = var.backup_retention_days >= 7 && var.backup_retention_days <= 35
    error_message = "Azure Flexible Server hỗ trợ 7–35 ngày."
  }
}

variable "geo_redundant_backup_enabled" {
  description = "S11: backup geo-redundant (khôi phục sang vùng khác) – bật ở production; chỉ đặt được khi tạo server"
  type        = bool
  default     = false
}

variable "slow_query_ms" {
  description = "S11: log_min_duration_statement (ms) – khớp DB_SLOW_QUERY_MS của API"
  type        = number
  default     = 200
}

variable "storage_auto_grow_enabled" {
  description = "S11: tự tăng dung lượng khi gần đầy (alert DiskUsageHigh vẫn bật)"
  type        = bool
  default     = true
}

variable "availability_zone" {
  type    = string
  default = "1"
}

variable "high_availability_enabled" {
  description = "ZoneRedundant HA (không hỗ trợ SKU Burstable) – chỉ prod"
  type        = bool
  default     = false
}

variable "administrator_login" {
  type    = string
  default = "allingo_admin"
}

variable "app_role_name" {
  description = "Vai trò runtime không BYPASSRLS"
  type        = string
  default     = "allingo_app"
}

variable "database_name" {
  type    = string
  default = "allingo"
}

variable "tags" {
  type    = map(string)
  default = {}
}
