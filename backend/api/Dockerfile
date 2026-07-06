# CAM API — deployed on Render (free web service).
# Render injects $PORT; uvicorn must bind 0.0.0.0.
FROM python:3.12-slim

WORKDIR /app

# Install deps first so code changes don't bust the pip cache layer.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
