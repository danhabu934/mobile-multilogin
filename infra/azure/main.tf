resource "azurerm_resource_group" "nexo" {
  name     = "nexo-mobile-rg"
  location = var.location
}

resource "azurerm_virtual_network" "nexo" {
  name                = "nexo-mobile-vnet"
  address_space       = ["10.42.0.0/16"]
  location            = azurerm_resource_group.nexo.location
  resource_group_name = azurerm_resource_group.nexo.name
}

resource "azurerm_subnet" "worker" {
  name                 = "android-worker-subnet"
  resource_group_name  = azurerm_resource_group.nexo.name
  virtual_network_name = azurerm_virtual_network.nexo.name
  address_prefixes     = ["10.42.1.0/24"]
}

resource "azurerm_network_security_group" "worker" {
  name                = "nexo-android-worker-nsg"
  location            = azurerm_resource_group.nexo.location
  resource_group_name = azurerm_resource_group.nexo.name

  security_rule {
    name                       = "ssh-from-admin"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "22"
    source_address_prefix      = var.admin_cidr
    destination_address_prefix = "*"
  }
}

resource "azurerm_public_ip" "worker" {
  name                = "nexo-android-worker-ip"
  location            = azurerm_resource_group.nexo.location
  resource_group_name = azurerm_resource_group.nexo.name
  allocation_method   = "Static"
  sku                 = "Standard"
}

resource "azurerm_network_interface" "worker" {
  name                = "nexo-android-worker-nic"
  location            = azurerm_resource_group.nexo.location
  resource_group_name = azurerm_resource_group.nexo.name

  ip_configuration {
    name                          = "worker"
    subnet_id                     = azurerm_subnet.worker.id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = azurerm_public_ip.worker.id
  }
}

resource "azurerm_network_interface_security_group_association" "worker" {
  network_interface_id      = azurerm_network_interface.worker.id
  network_security_group_id = azurerm_network_security_group.worker.id
}

resource "azurerm_linux_virtual_machine" "worker" {
  name                = "nexo-android-worker-1"
  resource_group_name = azurerm_resource_group.nexo.name
  location            = azurerm_resource_group.nexo.location
  size                = var.vm_size
  admin_username      = var.admin_username

  network_interface_ids = [azurerm_network_interface.worker.id]

  disable_password_authentication = true

  admin_ssh_key {
    username   = var.admin_username
    public_key = var.admin_ssh_public_key
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "StandardSSD_LRS"
    disk_size_gb         = 80
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "0001-com-ubuntu-server-jammy"
    sku       = "22_04-lts-gen2"
    version   = "latest"
  }

  custom_data = base64encode(templatefile("${path.module}/cloud-init.sh.tftpl", {
    repository_url = var.repository_url
  }))

  lifecycle {
    precondition {
      condition     = !startswith(var.vm_size, "Standard_B")
      error_message = "B-series free-tier VMs do not provide the CPU/RAM and nested virtualization required by the Android Emulator."
    }
  }
}

