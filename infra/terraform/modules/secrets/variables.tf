variable "name_prefix" {
  type = string
}

variable "location" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "key_vault_name" {
  description = "Tên Key Vault: 3–24 ký tự, chữ/số/gạch ngang, duy nhất toàn cầu (ví dụ kv-allingo-dev-x1)"
  type        = string

  validation {
    condition     = can(regex("^[a-zA-Z][a-zA-Z0-9-]{1,22}[a-zA-Z0-9]$", var.key_vault_name))
    error_message = "key_vault_name phải 3–24 ký tự, bắt đầu bằng chữ, chỉ chữ/số/gạch ngang."
  }
}

variable "purge_protection_enabled" {
  description = "Bật ở staging/prod (không thể tắt sau khi bật); dev để false cho phép destroy sạch"
  type        = bool
  default     = false
}

variable "secrets" {
  description = "Map tên-secret → giá trị (tên chỉ gồm chữ/số/gạch ngang)"
  type        = map(string)
  sensitive   = true
  default     = {}
}

variable "tags" {
  type    = map(string)
  default = {}
}
