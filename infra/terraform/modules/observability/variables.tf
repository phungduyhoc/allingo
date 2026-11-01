variable "name_prefix" {
  type = string
}

variable "location" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "retention_in_days" {
  description = "Số ngày giữ log/trace (30 dev, 90 staging/prod)"
  type        = number
  default     = 30
}

variable "daily_quota_gb" {
  description = "Trần ingest/ngày của Log Analytics (-1 = không giới hạn); đặt thấp ở dev để tránh hoá đơn bất ngờ"
  type        = number
  default     = 1
}

variable "sampling_percentage" {
  description = "Tỷ lệ lấy mẫu telemetry của Application Insights"
  type        = number
  default     = 100
}

variable "tags" {
  type    = map(string)
  default = {}
}
