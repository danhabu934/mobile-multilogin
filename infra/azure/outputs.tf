output "resource_group" {
  value = azurerm_resource_group.nexo.name
}

output "vm_name" {
  value = azurerm_linux_virtual_machine.worker.name
}

output "public_ip" {
  value = azurerm_public_ip.worker.ip_address
}

output "ssh_command" {
  value = "ssh ${var.admin_username}@${azurerm_public_ip.worker.ip_address}"
}

output "bootstrap_log_command" {
  value = "ssh ${var.admin_username}@${azurerm_public_ip.worker.ip_address} 'sudo tail -n 200 /var/log/cloud-init-output.log'"
}

