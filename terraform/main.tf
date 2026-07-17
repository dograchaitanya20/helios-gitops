terraform {
  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.34"
    }
  }
}

variable "do_token" {
  description = "DigitalOcean API token"
  type        = string
  sensitive   = true
}

variable "ssh_key_fingerprint" {
  description = "Fingerprint of an SSH key already uploaded to your DO account"
  type        = string
}

provider "digitalocean" {
  token = var.do_token
}

resource "digitalocean_droplet" "k3s_node" {
  image    = "ubuntu-22-04-x64"
  name     = "helios-k3s"
  region   = "blr1" # Bangalore — closest region for LPU/India-based demo
  size     = "s-2vcpu-4gb"
  ssh_keys = [var.ssh_key_fingerprint]

  # Bootstraps a single-node k3s cluster on first boot.
  # Cheap/free alternative to EKS/GKE for a student project.
  user_data = <<-EOF
    #!/bin/bash
    curl -sfL https://get.k3s.io | sh -s - --write-kubeconfig-mode 644
  EOF
}

resource "digitalocean_firewall" "k3s_fw" {
  name        = "helios-k3s-fw"
  droplet_ids = [digitalocean_droplet.k3s_node.id]

  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }
  inbound_rule {
    protocol         = "tcp"
    port_range       = "6443" # k3s API server
    source_addresses = ["0.0.0.0/0", "::/0"]
  }
  inbound_rule {
    protocol         = "tcp"
    port_range       = "80"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }
  inbound_rule {
    protocol         = "tcp"
    port_range       = "443"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }
  outbound_rule {
    protocol              = "tcp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}

output "cluster_ip" {
  value = digitalocean_droplet.k3s_node.ipv4_address
}
