variable "project_id" {
  description = "Google Cloud project ID that owns the Android worker."
  type        = string
}

variable "region" {
  description = "Google Cloud region."
  type        = string
  default     = "us-central1"
}

variable "zone" {
  description = "Google Cloud zone."
  type        = string
  default     = "us-central1-a"
}

variable "machine_type" {
  description = "Intel VM size. E2 is intentionally unsupported because it cannot provide nested virtualization."
  type        = string
  default     = "n2-standard-4"
}

variable "disk_size_gb" {
  description = "Boot disk size. Android SDK images and AVD snapshots use substantial space."
  type        = number
  default     = 80
}

variable "repository_url" {
  description = "Public Git repository cloned by the VM bootstrap."
  type        = string
  default     = "https://github.com/danhabu934/mobile-multilogin.git"
}

