output "instance_name" {
  value = google_compute_instance.android_worker.name
}

output "zone" {
  value = google_compute_instance.android_worker.zone
}

output "external_ip" {
  value = google_compute_instance.android_worker.network_interface[0].access_config[0].nat_ip
}

output "ssh_command" {
  value = "gcloud compute ssh ${google_compute_instance.android_worker.name} --zone ${var.zone} --tunnel-through-iap"
}

output "bootstrap_log_command" {
  value = "gcloud compute ssh ${google_compute_instance.android_worker.name} --zone ${var.zone} --tunnel-through-iap --command='sudo journalctl -u google-startup-scripts.service -n 200 --no-pager'"
}

