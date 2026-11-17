#!/bin/zsh
set -eu
app_dir="$HOME/Library/Application Support/Little Paws Finance"
domain="gui/$(id -u)"
label=com.littlepaws.finance
if ! /bin/launchctl print "$domain/$label" >/dev/null 2>&1; then
  /bin/launchctl bootstrap "$domain" "$app_dir/service.plist"
fi
for attempt in {1..20}; do
  if /usr/bin/curl --noproxy '*' --max-time 1 -fs -o /dev/null http://localhost:8000/; then
    print 'Mac: http://localhost:8000'
    wifi_ip=$(/sbin/ifconfig en0 | /usr/bin/awk '/^[[:space:]]*inet / {print $2; exit}')
    if [[ -n "$wifi_ip" ]] && /usr/bin/curl --noproxy '*' --max-time 1 -fs -o /dev/null "http://$wifi_ip:8000/"; then
      print "Wi-Fi: http://$wifi_ip:8000"
    fi
    exit 0
  fi
  sleep 0.25
done
print -u2 "เว็บยังไม่พร้อม ดูรายละเอียดใน $app_dir/data/server.log"
exit 1
