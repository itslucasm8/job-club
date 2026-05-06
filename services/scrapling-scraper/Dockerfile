# Playwright base image — has Chromium + system deps preinstalled, saves us
# the apt install + browser download steps inside the container.
FROM mcr.microsoft.com/playwright/python:v1.49.0-jammy

WORKDIR /app

COPY requirements.txt .
# Install Python deps, then run `scrapling install` which downloads the
# Playwright browsers StealthySession needs (Firefox + Chromium with stealth
# patches). The Playwright base image ships system deps but NOT browser
# binaries — without this step, AsyncStealthySession crashes at first request
# with "BrowserType.launch_persistent_context: Executable doesn't exist".
# NO `|| true` — fail the build loudly if install breaks rather than ship a
# broken container.
RUN pip install --no-cache-dir -r requirements.txt \
 && scrapling install

COPY app.py .
COPY adapters ./adapters

ENV PYTHONUNBUFFERED=1 \
    PORT=8091

EXPOSE 8091

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8091", "--workers", "2"]
