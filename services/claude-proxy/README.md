# Job Club Claude proxy

A small Flask service that shells out to the `claude` CLI on the host. It sits between the Job Club Next.js app (in Docker) and Lucas's Claude Max subscription, so the app can use Claude for extraction + classification without holding API credentials.

Mirrors the Sales Koala pattern. Same auth model (shared bearer token), same systemd deployment.

## Architecture

```
Next.js container (Docker)
    │  HTTP, Authorization: Bearer <secret>
    ▼
host.docker.internal:8090   ◄── Flask app (this service, on the VPS host)
    │
    │  subprocess.run(['claude', '-p', ...])
    ▼
`claude` CLI (OAuth-authenticated to Lucas's Claude Max account)
    │
    ▼
Anthropic — billed against the Max subscription, NOT the API
```

## Endpoints

| Method | Path        | Body                                  | Returns |
|--------|-------------|---------------------------------------|---------|
| GET    | `/health`   | —                                     | `{ok: true, claude_cli: "..."}`    |
| POST   | `/extract`  | `{url, page_text}`                    | Extracted job fields (or `extraction_failed`) |
| POST   | `/classify` | `{raw: {title, company, description, …}}` | Classifier scores |

All POSTs require `Authorization: Bearer <CLAUDE_PROXY_SECRET>`.

## VPS deploy (one-time)

Run on the VPS as root.

```bash
# 1. Install the service
mkdir -p /opt/jobclub-claude-proxy
cp /data/job-club/services/claude-proxy/{app.py,drafter.py,requirements.txt} /opt/jobclub-claude-proxy/
cd /opt/jobclub-claude-proxy
python3 -m venv venv
./venv/bin/pip install -r requirements.txt

# 2. Generate the shared secret (Next.js needs the same value)
SECRET=$(openssl rand -hex 32)
cat > /opt/jobclub-claude-proxy/.env <<EOF
CLAUDE_PROXY_SECRET=$SECRET
CLAUDE_PROXY_PORT=8090
EOF
chmod 600 /opt/jobclub-claude-proxy/.env
echo "Secret: $SECRET   <-- put this in /data/job-club/.env.production as CLAUDE_PROXY_SECRET"

# 3. Confirm the claude CLI is reachable as root
which claude   # e.g. /usr/local/bin/claude
claude -p --model claude-haiku-4-5 --output-format json <<< "say hello in JSON: {\"msg\":\"hello\"}"
# Should print a JSON envelope with {"result":"...","is_error":false,...}

# 4. Install + start the systemd unit
cp /data/job-club/services/claude-proxy/jobclub-claude-proxy.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now jobclub-claude-proxy.service
systemctl status jobclub-claude-proxy.service

# 5. Smoke-test from the host
curl -s http://127.0.0.1:8090/health
# {"claude_cli":"/usr/local/bin/claude","ok":true}

# 6. Smoke-test from inside the Job Club container
docker compose -f /data/job-club/docker-compose.yml exec app sh -c \
  'wget -qO- http://host.docker.internal:8090/health'
# {"claude_cli":"/usr/local/bin/claude","ok":true}
```

## Updating

Edits to `app.py` or `drafter.py` need re-deploy:

```bash
cp /data/job-club/services/claude-proxy/{app.py,drafter.py} /opt/jobclub-claude-proxy/
systemctl restart jobclub-claude-proxy.service
```

If `requirements.txt` changes:

```bash
cd /opt/jobclub-claude-proxy && ./venv/bin/pip install -r /data/job-club/services/claude-proxy/requirements.txt
systemctl restart jobclub-claude-proxy.service
```

## Logs

```bash
journalctl -u jobclub-claude-proxy.service -f
```

## Auth, scope, and security

- The Flask app binds to `0.0.0.0:8090` so the Job Club Docker container can reach it via the host bridge (`host.docker.internal`, configured in `docker-compose.yml` via `extra_hosts`). On Linux Docker, the container can't reach a `127.0.0.1`-bound host service.
- Bearer-token auth (`CLAUDE_PROXY_SECRET` — a 64-char hex secret) is the primary access control on the proxy. Constant-time comparison.
- **Firewall recommended:** Hostinger VPS exposes a public IPv4. Without UFW, port 8090 is reachable from the internet (still gated by the bearer token, but exposed to brute-force). Consider `ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw default deny incoming && ufw enable` to limit the attack surface. Sales Koala's `:8089` has the same exposure profile.
- The `claude` CLI runs as root (matching the systemd unit). It uses whatever Claude Max account that root user is OAuth-authenticated to. To re-auth: `claude` interactively as root and follow the OAuth flow.

## Why a separate service instead of inlining into Next.js?

1. The `claude` CLI lives on the host, not in the Next.js Docker container. We'd have to mount the binary + auth dir into the container, which is fragile.
2. One Claude proxy can serve multiple apps (Job Club, Sales Koala, future projects), all billed against one Max subscription.
3. Decouples LLM access from the app deployment. We can swap providers (or add fallbacks) without rebuilding the Next.js image.
