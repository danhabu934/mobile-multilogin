provider "google" {
  project = var.project_id
  region  = var.region
  zone    = var.zone
}

resource "google_compute_firewall" "iap_ssh" {
  name    = "nexo-android-worker-iap-ssh"
  network = "default"

  direction     = "INGRESS"
  source_ranges = ["35.235.240.0/20"]
  target_tags   = ["nexo-android-worker"]

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}

resource "google_compute_instance" "android_worker" {
  name         = "nexo-android-worker-1"
  machine_type = var.machine_type
  zone         = var.zone
  tags         = ["nexo-android-worker"]

  min_cpu_platform = "Intel Cascade Lake"

  advanced_machine_features {
    enable_nested_virtualization = true
  }

  boot_disk {
    initialize_params {
      image = "projects/ubuntu-os-cloud/global/images/family/ubuntu-2404-lts-amd64"
      size  = var.disk_size_gb
      type  = "pd-balanced"
    }
  }

  network_interface {
    network = "default"

    # An external address gives the bootstrap outbound Internet access. No
    # application port is opened; SSH is restricted to Google IAP above.
    access_config {}
  }

  metadata = {
    enable-oslogin = "TRUE"
  }

  metadata_startup_script = templatefile("${path.module}/startup.sh.tftpl", {
    repository_url = var.repository_url
  })

  scheduling {
    automatic_restart   = true
    on_host_maintenance = "MIGRATE"
  }

  shielded_instance_config {
    enable_secure_boot          = false
    enable_vtpm                 = true
    enable_integrity_monitoring = true
  }

  lifecycle {
    precondition {
      condition     = !startswith(lower(var.machine_type), "e2-")
      error_message = "E2 machines do not support nested virtualization. Choose an N2 or another compatible Intel machine type."
    }
  }
}

