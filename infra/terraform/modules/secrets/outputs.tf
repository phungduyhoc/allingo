output "key_vault_id" {
  value = azurerm_key_vault.this.id
}

output "key_vault_uri" {
  value = azurerm_key_vault.this.vault_uri
}

output "identity_id" {
  description = "Resource ID của user-assigned identity (gán cho Container Apps)"
  value       = azurerm_user_assigned_identity.apps.id
}

output "identity_principal_id" {
  value = azurerm_user_assigned_identity.apps.principal_id
}

output "identity_client_id" {
  value = azurerm_user_assigned_identity.apps.client_id
}

output "secret_ids" {
  description = "Map tên-secret → versionless_id (Container Apps luôn lấy phiên bản mới nhất)"
  value       = { for k, s in azurerm_key_vault_secret.this : k => s.versionless_id }
}
