import json
import re
import shutil
from pathlib import Path


ROOT = Path.cwd()
SITE = ROOT / "dist"
PAGES = (
    "index.html",
    "AmericanTranslator.html",
    "BritishTranslator.html",
    "videototext.html",
    "voice-to-sign.html",
    "ZimbabweanTranslator.html",
)


def read_index(filename, variable):
    source = (SITE / "js" / filename).read_text(encoding="utf-8")
    match = re.search(
        rf"window\.{re.escape(variable)}\s*=\s*(\[.*?\]);",
        source,
        re.DOTALL,
    )
    if not match:
        raise ValueError(f"Could not read {variable} from js/{filename}")
    return json.loads(match.group(1))


shutil.rmtree(SITE, ignore_errors=True)
SITE.mkdir(parents=True)

for page in PAGES:
    shutil.copy2(ROOT / page, SITE / page)

for directory in ("css", "images", "js"):
    shutil.copytree(ROOT / directory, SITE / directory)

(SITE / "js" / "site-config.js").write_text(
    "window.HAND_IN_HAND_DICTIONARY_MODE = 'snippets-only';\n",
    encoding="utf-8",
)

dictionary = SITE / "dictionary"
dictionary.mkdir()
for image in (ROOT / "dictionary").glob("*.PNG"):
    shutil.copy2(image, dictionary / image.name)

for directory in ("pdf-signs", "joy-sign-snippets"):
    shutil.copytree(
        ROOT / "dictionary" / directory,
        dictionary / directory,
    )

pdfs = [path for path in SITE.rglob("*") if path.is_file() and path.suffix.lower() == ".pdf"]
if pdfs:
    raise ValueError(f"PDFs must not be published: {pdfs[:5]}")

for page in PAGES:
    if ".pdf" in (SITE / page).read_text(encoding="utf-8").casefold():
        raise ValueError(f"PDF links or references must not be published: {page}")

for filename in read_index("dictionary-index.js", "SIGN_DICTIONARY_FILES"):
    if not (dictionary / filename).is_file():
        raise ValueError(f"Missing ZSL sign image: {filename}")

for filename, variable in (
    ("pdf-sign-index.js", "PDF_SIGN_DICTIONARY"),
    ("joy-sign-index.js", "JOY_SIGN_DICTIONARY"),
):
    for entry in read_index(filename, variable):
        image = entry.get("image")
        if image and not (SITE / image.removeprefix("./")).is_file():
            raise ValueError(f"Missing indexed sign image: {image}")

for letter in "abcdefghijklmnopqrstuvwxyz":
    filename = "G.png" if letter == "g" else f"{letter}.png"
    if not (SITE / "images" / "ZSL_signs" / filename).is_file():
        raise ValueError(f"Missing ZSL fingerspelling image: {filename}")

print("Netlify site prepared: indexed sign photos and ZSL fingerspelling verified; PDFs excluded.")
