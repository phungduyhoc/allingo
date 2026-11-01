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
  type    = number
  default = 7
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
