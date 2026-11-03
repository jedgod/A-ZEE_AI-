from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Dict, List, Optional, Protocol

from azai_core.errors import RetrievalError
from azai_core.logger import get_logger

logger = get_logger(__name__)

__all__ = ["WebResult", "WebSearchProvider", "WebRetriever"]


@dataclass
class WebResult:
    title: str
    url: str
    snippet: str


class WebSearchProvider(Protocol):
    """Implement with a real search API (Brave Search, Bing, SerpAPI, ...)."""

    def search(self, query: str, top_k: int) -> List[WebResult]:
        ...


class WebRetriever:
    """
    Web retrieval with a pluggable provider. With no provider configured it returns no results,
    rather than placeholder ones: invented "search results" would be passed to the model as if real.
    """

    def __init__(self, provider: Optional[WebSearchProvider] = None):
        self.provider = provider
        if provider is None:
            logger.info("web retrieval disabled (no search provider configured)")

    @property
    def enabled(self) -> bool:
        return self.provider is not None

    def search(self, query: str, top_k: int = 5) -> List[Dict[str, str]]:
        if not self.provider or not query.strip() or top_k < 1:
            return []
        try:
            results = self.provider.search(query, top_k)
        except Exception as error:  # provider SDKs raise many error types
            logger.exception("web retrieval failed")
            raise RetrievalError(str(error)) from error
        return [asdict(r) for r in results[:top_k]]
