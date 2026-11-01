terraform {
  # >= 1.9: validation biến được tham chiếu biến khác (enable_cloudflare ↔ zone/cert)
  required_version = ">= 1.9.0"

  # Phiên bản chính xác ghim trong .terraform.lock.hcl (commit tệp này sau `terraform init`).
  # azurerm cần bản 4.x đủ mới có `rbac_authorization_enabled` (Key Vault), `logs_destination` (ACA environment),
  # `mount_options` (volume Azure Files) – chọn bản 4.x mới nhất khi init lần đầu.
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    time = {
      source  = "hashicorp/time"
      version = "~> 0.12"
    }
  }
}

provider "azurerm" {
  # null → lấy từ ARM_SUBSCRIPTION_ID (CI) hoặc `az account show` (local)
  subscription_id = var.subscription_id

  # Resource provider đăng ký một lần bằng tay (README – Bootstrap) để principal CI không cần quyền cấp subscription
  resource_provider_registrations = "none"

  features {
    key_vault {
      # dev: xoá hẳn khi destroy để dùng lại tên; staging bật purge protection nên không purge được
      purge_soft_delete_on_destroy    = var.environment == "dev"
      recover_soft_deleted_key_vaults = true
    }

    resource_group {
      prevent_deletion_if_contains_resources = true
    }

    postgresql_flexible_server {
      # shared_preload_libraries là tham số tĩnh → tự restart server khi đổi
      restart_server_on_configuration_value_change = true
    }
  }
}

provider "cloudflare" {
  # null → lấy từ CLOUDFLARE_API_TOKEN. Quyền tối thiểu: xem infra/terraform/README.md
  api_token = var.cloudflare_api_token
}
