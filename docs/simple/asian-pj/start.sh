#!/bin/bash

# run ipcame
cd ~/Desktop/asian-pj/ipcame
docker compose up -d

# run rfid
cd ~/Desktop/asian-pj/rfid
docker compose up -d
