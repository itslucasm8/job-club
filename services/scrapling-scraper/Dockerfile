# Playwright base image — has Chromium + system deps preinstalled, saves us
# the apt install + browser download steps inside the container.
FROM mcr.microsoft.com/playwright/python:v1.49.0-jammy

WORKDIR /app

COPY requirements.txt .
# Scrapling 0.4.x's StealthySession is built on `patchright` (undetected
# Playwright fork), which ships its OWN browser install command separate
# from the vanilla `playwright install` baked into the base image. Without
# `patchright install chromium`, AsyncStealthySession crashes at first
# request with "BrowserType.launch_persistent_context: Executable doesn't
# exist". `scrapling install` is also run for any future-proofing it does
# (registering stealth patches etc.) — costs nothing if a no-op.
# NO `|| true` — fail the build loudly if install breaks rather than ship
# a broken container.
RUN pip install --no-cache-dir -r requirements.txt \
 && scrapling install \
 && patchright install chromium

COPY app.py .
COPY adapters ./adapters

ENV PYTHONUNBUFFERED=1 \
    PORT=8091

EXPOSE 8091

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8091", "--workers", "2"]
