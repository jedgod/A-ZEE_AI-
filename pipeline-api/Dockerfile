FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv
COPY requirements.txt .
# The English Presidio NLP model is installed at build time.
RUN pip install --no-cache-dir -r requirements.txt && python -m spacy download en_core_web_lg
RUN useradd --create-home --uid 10001 pipeline
COPY --chown=pipeline:pipeline . .
USER pipeline
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--limit-concurrency", "100"]
