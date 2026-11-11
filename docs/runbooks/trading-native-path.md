# Native staging trading path

Rebuild A-Zee, then restart the native services with `scripts/staging/native-up.ps1`.
Open `https://<gateway-host>:8443/trade/` after signing into A-Zee on that origin.
The gateway forwards only approved trading assets, paper-account/order and assistant
endpoints to the loopback AZTrade service. Other internal routes remain denied.

AZTrade sends assistant requests over mTLS to `https://localhost:18443/ai`.
The private listener authenticates the client certificate and service credential,
then forwards to the existing A-Zee pipeline at loopback `/api/aztrade/ai`.
It preserves HTTP statuses; the public gateway does not expose that private API.
Native startup configures these paths. Docker/nginx routing is NOT changed by this
patch and requires a separate topology-specific implementation and test.

Keep `AZ_PROVIDER_MODE=ollama-only`. Supply the approved Ollama model/digest/profile
through the existing `-AppEnv` parameter. No cloud fallback or execution flag is
enabled by this patch. Real end-to-end inference and browser/device tests are still
required after deployment. Tests here use disposable TLS and mock upstreams.

Maintenance accepts `-AlertCommand` and `-AlertOwner`; configure the existing SMTP
adapter only with the approved destination/credentials. A configured command is
not evidence of delivery: record a received test alert before closing that gate.
