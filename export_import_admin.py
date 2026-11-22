"""
   Copyright 2026 DGFiP / DTNum / Fabrique Numérique

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
"""
from pathlib import Path
import re
import argparse
import sys
import difflib
import shutil

RAW_HTML = """
<!DOCTYPE html>
<html lang="fr">
<head>
    <title>Import/export</title>
    <meta charset="UTF-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>

    <script src="https://docs.getgrist.com/grist-plugin-api.js"></script>
    <script src="exp_imp.js"></script>
</head>
    <body>
        <div id="root">
            <p>Export: <button id="export" type="button">export</button>
            <p>Import: <input id="import" type="file">
        </div>
    </body>
</html>        
""".strip()

RAW_JS = ""

CUR_PATH = Path(__file__).parent

def build_single_page(dsfr: bool):
    with (CUR_PATH / "dist/exp_imp.js").open("r", encoding="utf-8") as s:
        imp_exp_js = s.read()

    examples_path = CUR_PATH / "examples"
    if dsfr:
        with (examples_path / "dsfr-example.html").open("r", encoding="utf-8") as s:
            html = s.read()
        with (examples_path / "dsfr-example.js").open("r", encoding="utf-8") as s:
            js = s.read()
        filename = "dsfr_single_page.html"
    else:
        html = RAW_HTML
        js = RAW_JS
        filename = "raw_single_page.html"

    full_js = "\n".join([
        "",
        "/* " + "*" * 100,
        " * BEGIN exp_imp.js",
        " * Don't edit",
        " *" + "*" * 100 + "/",
        imp_exp_js,
        "/*" + "*" * 100,
        " * END exp_imp.js",
        " *" + "*" * 100 + "/",
        "",
        "/* BEGIN USER CODE */",
        js,
        "/* END USER CODE */",
        "",
    ])


    new_html = html.replace("<script src=\"exp_imp.js\"></script>", f"<script>{full_js}</script>")
    with (examples_path / filename).open("w", encoding="utf-8") as d:
        d.write(new_html)


def check(custom_widget_builder_path: Path):
    cwb_path = Path(__file__).parent / "custom-widget-builder"
    with open("cwb.diff", "w", encoding="utf-8") as f:
        for name in ("api.js", "api_deps.js", "index.html"):
            with (cwb_path / name).open("r", encoding="utf-8") as s:
                cur_lines = [line.rstrip() for line in s.readlines()]
            with (custom_widget_builder_path / name).open("r", encoding="utf-8") as s:
                original_lines = [line.rstrip() for line in s.readlines()]
            a_diff = difflib.unified_diff(
                original_lines, cur_lines, fromfile=f"cwb/{name}", tofile=f"exp-imp/{name}", lineterm="")
            f.write("\n".join(list(a_diff)))
            f.write("\n")

def build_pages(pages_path: Path):
    build_single_page(True)
    build_single_page(False)
    for p in (CUR_PATH / "custom-widget-builder").iterdir():
        shutil.copyfile(p, pages_path / p.name)

    for p in (CUR_PATH / "dist").glob("*.js"):
        shutil.copyfile(p, pages_path / p.name)
    for p in (CUR_PATH / "dist").glob("*.js.map"):
        shutil.copyfile(p, pages_path / p.name)

#    pages_locales_path = pages_path / "locales"
#    pages_locales_path.mkdir(exist_ok=True)
#    for p in (CUR_PATH / "src/locales").glob("*.json"):
#        shutil.copyfile(p, pages_locales_path / p.name)


if __name__ == "__main__":
    main_parser = argparse.ArgumentParser(
        description="Import-export admin tool",
        formatter_class=argparse.RawTextHelpFormatter)

    subparsers = main_parser.add_subparsers(title="command", dest="command")
    build_single_page_parser = subparsers.add_parser("sp", help="build a single page version")
    build_single_page_parser.add_argument("--dsfr", "-d", help="DSFR version", action='store_true')

    check_parser = subparsers.add_parser("check", help="check against custom widget builder")
    check_parser.add_argument("--path", "-p", help="path to the custom widget builder directory", type=str)

    build_pages_parser = subparsers.add_parser("pages", help="build pages distribution")
    build_pages_parser.add_argument("--path", "-p", help="path to the pages directory", type=str)

    args = main_parser.parse_args(sys.argv[1:])
    if args.command == "sp":
        build_single_page(args.dsfr)
    elif args.command == "check":
        check(Path(args.path).resolve())
    elif args.command == "pages":
        build_pages(Path(args.path).resolve())

