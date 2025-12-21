# vLLM Studio Security Guide

## Current Exposure Analysis

### Open Ports (as of scan)

| Port | Service | Binding | Exposed Via | Risk |
|------|---------|---------|-------------|------|
| 22 | SSH | 0.0.0.0 | CF Tunnel (ssh.homelabai.org) | HIGH |
| 3000 | Frontend | 0.0.0.0 | CF Tunnel (app.homelabai.org) | MEDIUM |
| 3389 | RDP | 0.0.0.0 | **DIRECT** | CRITICAL |
| 4100 | LiteLLM | 0.0.0.0 | **DIRECT** | HIGH |
| 5433 | PostgreSQL | 0.0.0.0 | **DIRECT** | CRITICAL |
| 6379 | Redis | 0.0.0.0 | **DIRECT** | HIGH |
| 8000 | vLLM | 0.0.0.0 | **DIRECT** | HIGH |
| 8080 | Backend API | 0.0.0.0 | CF Tunnel (homelabai.org) | MEDIUM |
| 9090 | Prometheus | 0.0.0.0 | **DIRECT** | MEDIUM |

### Cloudflare Tunnel Domains

| Domain | Service | CF Access Protected? |
|--------|---------|---------------------|
| app.homelabai.org | Frontend :3000 | **NO** |
| homelabai.org | Backend :8080 | **NO** |
| ssh.homelabai.org | SSH :22 | **NO** |

## Recommended Architecture

```
Internet → Cloudflare Access (auth) → CF Tunnel → localhost services
                    ↓
         Only authenticated users pass through
```

## Step-by-Step Setup

### Step 1: Bind Docker Services to Localhost

Edit `docker-compose.yml` to bind ports to `127.0.0.1`:

```yaml
# BEFORE (exposed to world):
ports:
  - "4100:4000"

# AFTER (localhost only):
ports:
  - "127.0.0.1:4100:4000"
```

Apply to these services:
- postgres: `127.0.0.1:5433:5432`
- litellm: `127.0.0.1:4100:4000`
- redis: `127.0.0.1:6379:6379`
- prometheus: `127.0.0.1:9090:9090`
- grafana: `127.0.0.1:3001:3000`

### Step 2: Set Up Cloudflare Access

1. Go to https://one.dash.cloudflare.com/

2. Navigate to: **Access → Applications → Add application**

3. Choose **Self-hosted**

4. Configure the application:
   ```
   Application name: HomeLab AI
   Session Duration: 24 hours

   Application domain(s):
   - app.homelabai.org
   - homelabai.org
   - REDACTED
   ```

5. Add a policy:
   ```
   Policy name: Allow Owner
   Action: Allow

   Configure rules:
   - Selector: Emails
   - Value: your.email@gmail.com
   ```

   OR for Google login:
   ```
   - Selector: Login Methods
   - Value: Google

   AND

   - Selector: Emails
   - Value: your.email@gmail.com
   ```

6. Save the application

### Step 3: Protect SSH Separately

SSH needs stricter protection:

1. Create another Access application:
   ```
   Application name: SSH Access
   Application domain: ssh.homelabai.org
   Application type: SSH
   ```

2. Add policy requiring WARP:
   ```
   Policy name: SSH - Require WARP
   Action: Allow

   Include:
   - Emails: your.email@gmail.com

   Require:
   - WARP client
   ```

3. To connect:
   ```bash
   # Install cloudflared on your laptop
   brew install cloudflared  # or apt install cloudflared

   # Connect via:
   cloudflared access ssh --hostname ssh.homelabai.org
   ```

### Step 4: Enable Firewall

```bash
# Reset and configure UFW
sudo ufw reset
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Allow SSH (fallback access)
sudo ufw allow 22/tcp

# Allow localhost
sudo ufw allow from 127.0.0.1

# Enable
sudo ufw enable
sudo ufw status
```

### Step 5: Set Backend API Key

```bash
# Create .env file
cd /home/ser/workspace/projects/lmvllm
echo "VLLM_STUDIO_API_KEY=$(openssl rand -hex 32)" >> .env
echo "LITELLM_MASTER_KEY=$(openssl rand -hex 32)" >> .env

# Restart services
docker-compose down
docker-compose up -d

# Restart backend
pkill -f "controller.cli"
source .env && nohup python -m controller.cli --port 8080 > /tmp/vllm-studio-backend.log 2>&1 &
```

## Verification Checklist

After setup, verify:

- [ ] Can access app.homelabai.org (after CF login)
- [ ] Cannot access app.homelabai.org in incognito (blocked by CF)
- [ ] Cannot directly access ports from internet (nmap from external)
- [ ] SSH only works via `cloudflared access ssh`
- [ ] Backend logs show CF-Connecting-IP headers

## Monitoring

Use the monitoring script:

```bash
# Real-time access logs
./scripts/monitor-access.sh --all

# Watch for blocked requests
./scripts/monitor-access.sh --blocked

# Quick summary
./scripts/monitor-access.sh --summary
```

## Security Checklist

- [ ] All docker ports bound to 127.0.0.1
- [ ] Cloudflare Access enabled for all domains
- [ ] SSH protected with WARP requirement
- [ ] UFW firewall enabled
- [ ] API keys set in .env
- [ ] RDP disabled or VPN-only
