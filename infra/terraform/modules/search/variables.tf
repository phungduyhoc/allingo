variable "app_name" {
  description = "Tên Container App (api dùng http://<app_name> làm MEILISEARCH_HOST)"
  type        = string
}

variable "location" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "container_app_environment_id" {
  type = string
}

variable "storage_account_name" {
  description = "3–24 ký tự chữ thường/số, duy nhất toàn cầu (ví dụ stallingodevmeili)"
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]{3,24}$", var.storage_account_name))
    error_message = "storage_account_name chỉ gồm chữ thường/số, 3–24 ký tự."
  }
}

variable "share_quota_gb" {
  type    = number
  default = 10
}

variable "image" {
  description = "Cùng phiên bản với infra/docker/compose.dev.yml"
  type        = string
  default     = "getmeili/meilisearch:v1.15"
}

variable "cpu" {
  type    = number
  default = 0.5
}

variable "memory" {
  type    = string
  default = "1Gi"
}

variable "max_indexing_memory" {
  type    = string
  default = "512Mb"
}

variable "master_key" {
  type      = string
  sensitive = true
}

variable "tags" {
  type    = map(string)
  default = {}
}
