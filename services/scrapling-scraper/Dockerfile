# Playwright base image — has Chromium + system deps preinstalled, saves us
# the apt install + browser download steps inside the container.
FROM mcr.microsoft.com/playwright/python:v1.49.0-jammy

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
 && python -m scrapling install || true

COPY app.py .
COPY adapters ./adapters

ENV PYTHONUNBUFFERED=1 \
    PORT=8091

EXPOSE 8091

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8091", "--workers", "2"]
