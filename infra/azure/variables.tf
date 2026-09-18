variable "subscription_id" {
  description = "Azure subscription ID used for the Android worker."
  type        = string
}

variable "location" {
  description = "Azure region. East US normally has broad Dv3 availability and lower latency-independent cost than Brazil South."
  type        = string
  default     = "East US"
}

variable "vm_size" {
  description = "Hyper-threaded Azure VM size compatible with nested virtualization."
  type        = string
  default     = "Standard_D4s_v3"
}

variable "admin_username" {
  description = "Linux administrator username."
  type        = string
  default     = "nexoadmin"
}

variable "admin_ssh_public_key" {
  description = "OpenSSH public key used to access the worker."
  type        = string
  sensitive   = true
}

variable "admin_cidr" {
  description = "Your public IPv4 address followed by /32. Only this address can reach SSH."
  type        = string

  validation {
    condition     = can(cidrhost(var.admin_cidr, 0)) && var.admin_cidr != "0.0.0.0/0"
    error_message = "Set admin_cidr to your public IPv4 address with /32. Do not expose SSH to 0.0.0.0/0."
  }
}

variable "repository_url" {
  description = "Public Git repository cloned by cloud-init."
  type        = string
  default     = "https://github.com/danhabu934/mobile-multilogin.git"
}

