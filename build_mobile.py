"""Builds the standalone phone version into the `docs/` folder.

docs/ is a plain static website (no Flask needed). Upload/host it anywhere with
https (GitHub Pages, Netlify, Cloudflare Pages...) and open it on your phone.
Places are stored on the phone itself.

Run:  python build_mobile.py
"""
import os
import re
import shutil

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "docs")

if os.path.isdir(OUT):
    shutil.rmtree(OUT)
os.makedirs(OUT)

html = open(os.path.join(ROOT, "templates", "index.html"), encoding="utf-8").read()
html = re.sub(r"\{\{\s*url_for\('static',\s*filename='([^']+)'\)\s*\}\}", r"static/\1", html)
html = re.sub(r"\{\{\s*url_for\('manifest'\)\s*\}\}", "manifest.webmanifest", html)
html = html.replace(
    'window.POI_MODE = "server"; window.INITIAL_POI = {{ poi|tojson }};',
    'window.POI_MODE = "local"; window.INITIAL_POI = [];',
)
html = re.sub(r'\s*<a id="phone-link".*?</a>', "", html, flags=re.S)  # PC-only link
assert "{{" not in html, "unreplaced template tag"
open(os.path.join(OUT, "index.html"), "w", encoding="utf-8").write(html)

shutil.copytree(os.path.join(ROOT, "static"), os.path.join(OUT, "static"),
                ignore=shutil.ignore_patterns("sw.js", "manifest.webmanifest"))
shutil.copy(os.path.join(ROOT, "static", "sw.js"), OUT)
shutil.copy(os.path.join(ROOT, "static", "manifest.webmanifest"), OUT)
open(os.path.join(OUT, ".nojekyll"), "w").close()
print("Built phone version in:", OUT)
