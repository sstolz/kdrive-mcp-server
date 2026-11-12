#!/bin/bash
# F-015 BR-224: self-test of the runner egress filter (BR-219), run by
# ops/runner/supervise.sh as the kdrive-runner user before every limactl start.
# A UDP datagram to 9.9.9.9:53 (never a recorded resolver, BR-220) must be
# refused at once with EPERM by the output chain. Exit 0 only in that case.
set -u

output=$(LC_ALL=C timeout 5 bash -c "printf 'x' > /dev/udp/9.9.9.9/53" 2>&1)
status=$?
if test "$status" -ne 0 && test "$status" -ne 124 &&
  printf '%s' "$output" | grep -q 'Operation not permitted'; then
  exit 0
fi
printf '%s\n' 'egress self-test: a UDP datagram to the direct-DNS probe target was not refused with EPERM.' >&2
exit 1
