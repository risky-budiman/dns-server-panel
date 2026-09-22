cat << 'EOF' | sudo tee /var/lib/bind/kominfo.rpz
$TTL 3600
@ IN SOA localhost. root.localhost. ( 2026092301 3h 1h 1w 1h )
  IN NS  localhost.
EOF

cat << 'EOF' | sudo tee /var/lib/bind/custom_whitelist.rpz
$TTL 3600
@ IN SOA localhost. root.localhost. ( 2026092301 3h 1h 1w 1h )
  IN NS  localhost.
EOF

sudo chown -R bind:bind /var/lib/bind/ /etc/bind/zones/
sudo named-checkconf
sudo systemctl restart named