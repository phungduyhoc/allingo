variable "name_prefix" {
  description = "Tiền tố tên tài nguyên, ví dụ allingo-dev"
  type        = string
}

variable "location" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "address_space" {
  description = "CIDR của VNet"
  type        = string
  default     = "10.10.0.0/16"
}

variable "aca_subnet_prefix" {
  type    = string
  default = "10.10.0.0/24"
}

variable "postgres_subnet_prefix" {
  type    = string
  default = "10.10.1.0/28"
}

variable "private_endpoints_subnet_prefix" {
  type    = string
  default = "10.10.2.0/27"
}

variable "tags" {
  type    = map(string)
  default = {}
}
