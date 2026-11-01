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
