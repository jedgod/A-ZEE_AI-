import ast
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_builder():
    spec = importlib.util.spec_from_file_location("build_prototype", ROOT / "scripts" / "build_prototype.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_prototype_embeds_current_app_sources():
    builder = load_builder()
    current = (ROOT / "prototype.py").read_text(encoding="utf-8")
    assert current == builder.render(), "prototype.py is stale: run python scripts/build_prototype.py"


def test_prototype_is_valid_python_with_every_module():
    tree = ast.parse((ROOT / "prototype.py").read_text(encoding="utf-8"))
    sources = next(node.value for node in tree.body
                   if isinstance(node, ast.Assign) and node.targets[0].id == "SOURCES")
    names = {key.value for key in sources.keys}
    assert names == {"app/__init__.py", "app/context.py", "app/main.py",
                     "app/models.py", "app/preprocess.py", "app/settings.py"}
