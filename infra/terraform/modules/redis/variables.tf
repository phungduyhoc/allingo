variable "name_prefix" {
  type = string
}

variable "location" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "sku_name" {
  description = "Basic (dev, không SLA) | Standard (staging/prod, 2 node)"
  type        = string
  default     = "Basic"
}

variable "family" {
  type    = string
  default = "C"
}

variable "capacity" {
  description = "0 = 250 MB, 1 = 1 GB, 2 = 2.5 GB"
  type        = number
  default     = 0
}

variable "private_endpoint_subnet_id" {
  type = string
}

variable "private_dns_zone_id" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "rdb_backup" {
  description = <<-EOT
    S11: RDB persistence – CHỈ tier Premium (Basic/Standard không có). null = tắt (dev/staging: dữ liệu Redis tái tạo được –
    quota chốt từ DB, cache, BullMQ id nghiệp vụ). Production: { frequency_minutes = 60, max_snapshots = 1, storage_connection_string = … }.
  EOT
  type = object({
    frequency_minutes         = number
    max_snapshots             = optional(number, 1)
    storage_connection_string = string
  })
  default   = null
  sensitive = true

  validation {
    condition     = var.rdb_backup == null || contains([15, 30, 60, 360, 720, 1440], try(var.rdb_backup.frequency_minutes, 60))
    error_message = "frequency_minutes ∈ {15, 30, 60, 360, 720, 1440}."
  }
}
