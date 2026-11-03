class AppError(Exception):
    """Base application error."""


class SafetyFilterError(AppError):
    """Raised when content fails safety checks."""


class RetrievalError(AppError):
    """Raised when retrieval fails."""


class MemoryStoreError(AppError):
    """Raised when memory operations fail. (Not named MemoryError, which would shadow the builtin.)"""


class ContextCompactionError(AppError):
    """Raised when compaction fails."""
