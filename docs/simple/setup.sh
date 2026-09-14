#!/bin/bash

set -e  # Exit immediately if a command exits with a non-zero status.

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to show usage
show_usage() {
    echo "Usage: $0 -u <username> -p <password>"
    exit 1
}

# Parse command-line arguments
while getopts ":u:p:" opt; do
    case $opt in
        u) DOCKER_USERNAME="$OPTARG"
        ;;
        p) DOCKER_PASSWORD="$OPTARG"
        ;;
        \?) echo "Invalid option -$OPTARG" >&2
            show_usage
        ;;
        :) echo "Option -$OPTARG requires an argument." >&2
            show_usage
        ;;
    esac
done

# Check if username and password are provided
if [ -z "$DOCKER_USERNAME" ] || [ -z "$DOCKER_PASSWORD" ]; then
    show_usage
fi

# Step 0: Wait for any unattended upgrades to finish
while sudo fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1; do
    echo "Waiting for unattended upgrades to finish..."
    sleep 10
done

# Step 1: Update and upgrade the system
echo "Updating and upgrading the system..."
sudo apt-get update
sudo apt-get upgrade -y

# Step 2: Install curl if not already installed
if command_exists curl; then
    echo "curl is already installed."
else
    echo "Installing curl..."
    sudo apt-get install -y curl
fi

# Step 3: Install Docker if not already installed
if command_exists docker; then
    echo "Docker is already installed."
else
    echo "Installing Docker..."
    sudo curl -sSl https://get.docker.com | sh
fi

# Step 4: Add the current user to the docker group
echo "Adding the current user to the Docker group..."
sudo groupadd -f docker
sudo usermod -aG docker $USER

# Step 5: Download, extract the zip file from Firebase storage, and delete the zip file
echo "Downloading and extracting the zip file from Firebase storage..."

# Firebase URL
firebase_url="https://mgexqffhjwebrneoszkh.supabase.co/storage/v1/object/public/asian/asian-pj.zip"

# Download with retries
curl --retry 5 --retry-delay 10 --max-time 600 -o ~/Desktop/asean-project.zip "$firebase_url" || { echo "Failed to download zip file"; exit 1; }

# Extract content and move to the correct location
unzip ~/Desktop/asean-project.zip || { echo "Failed to unzip file"; exit 1; }
mv ~/Desktop/asian-pj ~/Desktop/asean-project 
rm ~/Desktop/asean-project.zip

# Step 6: Install Syncthing
echo "Installing Syncthing..."
# Add the release PGP keys
sudo mkdir -p /etc/apt/keyrings
sudo curl -L -o /etc/apt/keyrings/syncthing-archive-keyring.gpg https://syncthing.net/release-key.gpg || { echo "Failed to download Syncthing key"; exit 1; }
# Add the "stable" channel to your APT sources
echo "deb [signed-by=/etc/apt/keyrings/syncthing-archive-keyring.gpg] https://apt.syncthing.net/ syncthing stable" | sudo tee /etc/apt/sources.list.d/syncthing.list
# Update and install Syncthing
sudo apt-get update
sudo apt-get install -y syncthing || { echo "Failed to install Syncthing"; exit 1; }

# Step 7: Copy the Syncthing service file and enable/start it
SYNCTHING_SERVICE=~/Desktop/asean-project/syncthing.service
if [ -f "$SYNCTHING_SERVICE" ]; then
    echo "Copying the Syncthing service file and enabling it..."
    sudo cp "$SYNCTHING_SERVICE" /etc/systemd/system/syncthing.service
    sudo systemctl start syncthing.service
else
    echo "Syncthing service file not found, skipping..."
    exit 1
fi

# Step 8: Docker login for registry.gitlab.com
echo "Logging into Docker for registry.gitlab.com..."
echo "$DOCKER_PASSWORD" | docker login registry.gitlab.com -u "$DOCKER_USERNAME" --password-stdin || { echo "Docker login failed"; exit 1; }

# Step 9: Enable xhost for Docker to access it
echo "Enabling xhost for Docker..."
xhost +local:docker > /dev/null

# Ensure xhost command is run at boot by adding it to .bashrc
if ! grep -q "xhost +local:docker" ~/.bashrc; then
    echo "Adding xhost command to .bashrc for execution at boot..."
    echo "xhost +local:docker > /dev/null" >> ~/.bashrc
fi

echo "All steps completed successfully."
