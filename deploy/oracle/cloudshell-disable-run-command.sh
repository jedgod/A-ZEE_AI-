#!/usr/bin/env bash
# Run in OCI Cloud Shell. Disables ONLY the "Compute Instance Run Command" Oracle Cloud Agent plugin on a_zee-ai-server (it never worked there and its
# 'runcommand' process holds ~60 MB of the host's scarce RAM). Monitoring stays enabled. Reversible: set desiredState to ENABLED. No restart of the VM is involved.
#   ./cloudshell-disable-run-command.sh              -> DRY RUN: shows the current plugin state and the command; changes nothing
#   CONFIRM=yes ./cloudshell-disable-run-command.sh  -> applies
set -euo pipefail
NAME="${NAME:-a_zee-ai-server}"; COMP="${OCI_TENANCY:?run this in OCI Cloud Shell}"
INST=$(oci compute instance list --compartment-id "$COMP" --display-name "$NAME" --lifecycle-state RUNNING --query 'data[0].id' --raw-output)
[ -n "$INST" ] && [ "$INST" != "null" ] || { echo "REFUSING: running instance $NAME not found"; exit 2; }
echo "instance: ${INST:0:40}..."; echo "== current agent configuration"
oci compute instance get --instance-id "$INST" --query 'data."agent-config"'
CFG='{"isMonitoringDisabled":false,"isManagementDisabled":false,"pluginsConfig":[{"name":"Compute Instance Run Command","desiredState":"DISABLED"},{"name":"Compute Instance Monitoring","desiredState":"ENABLED"}]}'
echo; echo "== change to apply"; echo "$CFG"
[ "${CONFIRM:-no}" = "yes" ] || { echo "DRY RUN: nothing changed. To apply: CONFIRM=yes $0"; exit 0; }
oci compute instance update --instance-id "$INST" --agent-config "$CFG" --force --query 'data."agent-config"'
echo "Applied. The Run Command plugin should show Disabled on the instance's Management tab within a few minutes."
