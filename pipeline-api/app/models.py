from datetime import datetime
from uuid import uuid4

from pgvector.sqlalchemy import Vector
from sqlalchemy import DateTime, Index, String, Text, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.settings import settings


class Base(DeclarativeBase):
    pass


class Document(Base):
    """Tenant-scoped document with its embedding (pgvector)."""

    __tablename__ = "documents"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid4()))
    tenant: Mapped[str] = mapped_column(String, index=True)
    title: Mapped[str] = mapped_column(String(200))
    content: Mapped[str] = mapped_column(Text)
    embedding: Mapped[list[float]] = mapped_column(Vector(settings().embedding_dimensions))


Index(
    "documents_embedding_hnsw", Document.embedding,
    postgresql_using="hnsw", postgresql_ops={"embedding": "vector_cosine_ops"},
)


class Memory(Base):
    """Explicit long-term memory; never inferred automatically."""

    __tablename__ = "memories"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid4()))
    tenant: Mapped[str] = mapped_column(String, index=True)
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SessionEvent(Base):
    """Chronological session history."""

    __tablename__ = "session_events"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid4()))
    tenant: Mapped[str] = mapped_column(String, index=True)
    session_id: Mapped[str] = mapped_column(String(128), index=True)
    role: Mapped[str] = mapped_column(String(20))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
