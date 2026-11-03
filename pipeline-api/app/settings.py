from functools import lru_cache

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Validated configuration. One local token maps to one trusted tenant, never a client-supplied tenant ID."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_url: str = "postgresql+asyncpg://pipeline:pipeline@db:5432/pipeline"
    api_token: SecretStr
    tenant_id: str = "local"

    # Moderation always uses OpenAI's moderation endpoint (it doesn't consume paid credits).
    openai_api_key: SecretStr

    # Embeddings and the LangChain chat model accept any OpenAI-compatible endpoint, e.g.
    # Gemini: https://generativelanguage.googleapis.com/v1beta/openai (gemini-embedding-001, 1536 dims).
    # Keys default to OPENAI_API_KEY when unset.
    embedding_api_base: str = "https://api.openai.com/v1"
    embedding_api_key: SecretStr | None = None
    embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = Field(default=1536, ge=1, le=2000)
    chat_api_base: str = "https://api.openai.com/v1"
    chat_api_key: SecretStr | None = None
    chat_model: str = "gpt-4o-mini"

    # en_core_web_lg is most accurate for names/locations; en_core_web_sm (12 MB) suits light dev setups.
    spacy_model: str = "en_core_web_lg"
    brave_api_key: SecretStr = SecretStr("")
    context_tokens: int = Field(default=4000, ge=256, le=16000)

    def key_for(self, which: str) -> str:
        specific = self.embedding_api_key if which == "embedding" else self.chat_api_key
        return (specific or self.openai_api_key).get_secret_value()


@lru_cache
def settings() -> Settings:
    return Settings()
