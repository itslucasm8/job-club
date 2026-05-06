# Playwright base image — has Chromium + system deps preinstalled, saves us
# the apt install + browser download steps inside the container.
FROM mcr.microsoft.com/playwright/python:v1.49.0-jammy

WORKDIR /app

COPY requirements.txt .
# Install Python deps, then download Camoufox (the modified Firefox that
# scrapling's StealthySession uses — NOT in the Playwright base image, which
# only ships Chromium). Belt-and-suspenders: scrapling's CLI installer first,
# then a direct camoufox fetch as a fallback. NO `|| true` — if either fails
# we want the build to fail loudly rather than ship a broken container.
RUN pip install --no-cache-dir -r requirements.txt \
 && scrapling install \
 && python -m camoufox fetch

COPY app.py .
COPY adapters ./adapters

ENV PYTHONUNBUFFERED=1 \
    PORT=8091

EXPOSE 8091

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8091", "--workers", "2"]
