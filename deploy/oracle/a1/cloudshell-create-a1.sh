#!/usr/bin/env bash
# Run in OCI Cloud Shell (it is already signed in as you; no credentials are typed or stored). Creates ONE A1 Flex VM, but only when you say so:
#   ./cloudshell-create-a1.sh              -> DRY RUN: validates everything and prints the exact launch command; creates nothing
#   CONFIRM=yes ./cloudshell-create-a1.sh  -> actually launches (a billable-capable resource: confirm your Always Free/trial limits first)
# Before running: put your PUBLIC key in ~/azee-a1.pub (the single line from azee-a1.key.pub on your PC). A private key must never be pasted here.
set -euo pipefail
NAME="${NAME:-azee-a1-staging}"; OCPUS="${OCPUS:-2}"; MEM_GB="${MEM_GB:-12}"; BOOT_GB="${BOOT_GB:-50}"; SHAPE="VM.Standard.A1.Flex"
SUBNET_NAME="${SUBNET_NAME:-a_zee-public-subnet}"; PUBKEY="${PUBKEY:-$HOME/azee-a1.pub}"; COMP="${OCI_TENANCY:?run this in OCI Cloud Shell}"

[ -s "$PUBKEY" ] || { echo "REFUSING: $PUBKEY not found. Save your PUBLIC key there first."; exit 2; }
grep -q 'PRIVATE KEY' "$PUBKEY" && { echo "REFUSING: that file contains a PRIVATE key. Never paste private keys. Delete it."; exit 2; }
grep -qE '^(ssh-ed25519|ssh-rsa|ecdsa-sha2-)' "$PUBKEY" || { echo "REFUSING: $PUBKEY is not a public key line"; exit 2; }
[ "$OCPUS" -le 4 ] && [ "$MEM_GB" -le 24 ] || { echo "REFUSING: above the commonly published Always Free A1 allowance (4 OCPU / 24 GB total); confirm your limits first"; exit 2; }

echo "== existing instances in this compartment (check Always Free totals; A1 allowance is shared across all A1 instances)"
oci compute instance list --compartment-id "$COMP" --lifecycle-state RUNNING --query 'data[].{name:"display-name",shape:shape,ocpus:"shape-config".ocpus,mem:"shape-config"."memory-in-gbs"}' --output table
echo "== A1 limits (look for available > 0)"
oci limits resource-availability get --compartment-id "$COMP" --service-name compute --limit-name standard-a1-core-count --availability-domain "$(oci iam availability-domain list --compartment-id "$COMP" --query 'data[0].name' --raw-output)" --query 'data.{used:used,available:available}' 2>/dev/null || echo "(could not read limits; check Governance -> Limits, Quotas and Usage)"

SUBNET=$(oci network subnet list --compartment-id "$COMP" --display-name "$SUBNET_NAME" --query 'data[0].id' --raw-output); [ -n "$SUBNET" ] && [ "$SUBNET" != "null" ] || { echo "REFUSING: subnet $SUBNET_NAME not found"; exit 2; }
IMG=$(oci compute image list --compartment-id "$COMP" --operating-system "Oracle Linux" --operating-system-version 9 --shape "$SHAPE" --sort-by TIMECREATED --sort-order DESC --query 'data[0].id' --raw-output)
[ -n "$IMG" ] && [ "$IMG" != "null" ] || { echo "REFUSING: no Oracle Linux 9 image compatible with $SHAPE found (is A1 offered in this region?)"; exit 2; }
echo "image : $(oci compute image get --image-id "$IMG" --query 'data."display-name"' --raw-output)"
echo "subnet: $SUBNET_NAME"; echo "size  : $OCPUS OCPU / $MEM_GB GB RAM / $BOOT_GB GB boot volume; name $NAME"
echo "key   : $(ssh-keygen -lf "$PUBKEY")"

ADS=$(oci iam availability-domain list --compartment-id "$COMP" --query 'data[].name' --raw-output | tr -d '[]," ' | tr '\n' ' ')
echo "availability domains to try: $ADS"
launch() { oci compute instance launch --availability-domain "$1" --compartment-id "$COMP" --shape "$SHAPE" --shape-config "{\"ocpus\":$OCPUS,\"memoryInGBs\":$MEM_GB}" \
  --image-id "$IMG" --subnet-id "$SUBNET" --assign-public-ip true --display-name "$NAME" --boot-volume-size-in-gbs "$BOOT_GB" --ssh-authorized-keys-file "$PUBKEY" \
  --agent-config '{"isMonitoringDisabled":false,"isManagementDisabled":false,"pluginsConfig":[{"name":"Compute Instance Run Command","desiredState":"DISABLED"}]}' --wait-for-state RUNNING; }
if [ "${CONFIRM:-no}" != "yes" ]; then echo; echo "DRY RUN: nothing was created. To launch: CONFIRM=yes $0"; exit 0; fi
for AD in $ADS; do echo "== trying $AD"; if launch "$AD"; then echo "LAUNCHED in $AD. Now: Console -> Instances -> $NAME -> note the public IP; then Console history for the host-key fingerprints."; exit 0; fi; echo "(failed in $AD; trying the next)"; done
echo "No availability domain had A1 capacity right now. Retry later; nothing was created."; exit 1
