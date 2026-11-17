#!/bin/zsh
set -eu
service="gui/$(id -u)/com.littlepaws.finance"
if /bin/launchctl print "$service" >/dev/null 2>&1; then
  /bin/launchctl bootout "$service"
fi
print 'ปิด Little Paws Finance Manager แล้ว'
