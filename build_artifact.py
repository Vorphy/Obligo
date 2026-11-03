#!/usr/bin/env python3
"""Buduje jednoplikową wersję kalkulatora do publikacji jako artefakt (dist/kalkulator.html).
Wkleja engine.js i data.js do strony i usuwa szkielet dokumentu (dodaje go platforma)."""
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
page = (HERE / "index.html").read_text(encoding="utf-8")
engine = (HERE / "engine.js").read_text(encoding="utf-8")
data = (HERE / "data.js").read_text(encoding="utf-8")

for tag in [r"<!doctype html>", r'<html[^>]*>', r"</?head>", r"<body>", r"</body>", r"</html>",
            r'<meta charset="utf-8">', r'<meta name="viewport"[^>]*>']:
    page = re.sub(tag + r"\s*", "", page, flags=re.I)

page = page.replace('<script src="engine.js"></script>', "<script>\n" + engine + "\n</script>")
page = page.replace('<script src="data.js" id="dataScript"></script>',
                    '<script id="dataScript">\nwindow.PUBLISHED = true;\n' + data + "\n</script>")
assert "src=\"engine.js\"" not in page and "src=\"data.js\"" not in page

out = HERE / "dist" / "kalkulator.html"
out.parent.mkdir(exist_ok=True)
out.write_text(page.lstrip(), encoding="utf-8")
print("Zapisano", out, f"({len(page) // 1024} KB)")
