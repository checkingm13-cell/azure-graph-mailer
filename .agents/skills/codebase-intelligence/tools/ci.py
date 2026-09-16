#!/usr/bin/env python3
"""
codebase-intelligence: deterministic facts layer.

This tool never interprets. It extracts facts and derives graphs, so the
model reasoning on top receives a small, relevant, evidence-backed context
instead of a whole repository.

Subcommands:
  index     walk the repo, extract symbols/imports/signals into cache/ir.db
  graph     dependency graph, cycles, layering violations
  signals   UI / responsive / feedback-gap findings with evidence + confidence
  context   minimal context pack for a set of changed files (levels 0-5)
  stats     what the index knows

Stdlib only. No network. Safe to run offline.
"""

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
from collections import defaultdict, deque

SCHEMA_VERSION = 3

# --------------------------------------------------------------------------
# language table
# --------------------------------------------------------------------------

LANG_BY_EXT = {
    ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
    ".ts": "typescript", ".tsx": "typescript",
    ".py": "python",
    ".go": "go",
    ".rb": "ruby",
    ".php": "php",
    ".java": "java",
    ".kt": "kotlin",
    ".rs": "rust",
    ".cs": "csharp",
    ".swift": "swift",
    ".dart": "dart",
    ".vue": "vue",
    ".svelte": "svelte",
    ".css": "css", ".scss": "css", ".sass": "css", ".less": "css",
    ".html": "html", ".htm": "html",
    ".sql": "sql",
    ".sh": "shell", ".bash": "shell",
    ".yml": "config", ".yaml": "config", ".json": "config", ".toml": "config",
}

# Files whose content is markup/styling the UI rules care about.
UI_LANGS = {"javascript", "typescript", "vue", "svelte", "html", "css", "dart"}

DEFAULT_IGNORES = [
    ".git/*", "node_modules/*", "*/node_modules/*", "dist/*", "build/*", "out/*",
    ".next/*", ".nuxt/*", "target/*", "vendor/*", "__pycache__/*", "*.min.js",
    "*.min.css", "*.lock", "*.map", ".venv/*", "venv/*", "coverage/*",
    ".agents/skills/*/cache/*", "*.snap", "*.bundle.js",
]

MAX_FILE_BYTES = 800_000


# --------------------------------------------------------------------------
# scanning
# --------------------------------------------------------------------------

def load_gitignore(root: str) -> list[str]:
    pats: list[str] = []
    gi = os.path.join(root, ".gitignore")
    if not os.path.isfile(gi):
        return pats
    with open(gi, "r", encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or line.startswith("!"):
                continue
            line = line.rstrip("/")
            pats.append(line if "/" in line else "*/" + line)
            pats.append(line + "/*")
    return pats


def is_ignored(rel: str, patterns: list[str]) -> bool:
    for p in patterns:
        if fnmatch.fnmatch(rel, p) or fnmatch.fnmatch("/" + rel, "*/" + p.lstrip("*/")):
            return True
    return False


def walk_repo(root: str, extra_ignores: list[str]):
    patterns = DEFAULT_IGNORES + load_gitignore(root) + extra_ignores
    for dirpath, dirnames, filenames in os.walk(root):
        rel_dir = os.path.relpath(dirpath, root)
        rel_dir = "" if rel_dir == "." else rel_dir.replace(os.sep, "/")
        dirnames[:] = [
            d for d in dirnames
            if not is_ignored((rel_dir + "/" + d).lstrip("/") + "/x", patterns)
        ]
        for fn in filenames:
            rel = (rel_dir + "/" + fn).lstrip("/")
            if is_ignored(rel, patterns):
                continue
            ext = os.path.splitext(fn)[1].lower()
            if ext not in LANG_BY_EXT:
                continue
            full = os.path.join(dirpath, fn)
            try:
                st = os.stat(full)
            except OSError:
                continue
            if st.st_size > MAX_FILE_BYTES:
                continue
            yield rel, full, st


def sha1_of(path: str) -> str:
    h = hashlib.sha1()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


# --------------------------------------------------------------------------
# storage
# --------------------------------------------------------------------------

DDL = """
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY, lang TEXT, sha1 TEXT, mtime REAL, loc INTEGER, role TEXT
);
CREATE TABLE IF NOT EXISTS symbols (
  path TEXT, name TEXT, kind TEXT, line INTEGER, sig TEXT
);
CREATE TABLE IF NOT EXISTS imports (
  path TEXT, raw TEXT, resolved TEXT, line INTEGER, external INTEGER
);
CREATE TABLE IF NOT EXISTS calls (
  path TEXT, caller TEXT, callee TEXT, line INTEGER
);
CREATE TABLE IF NOT EXISTS signals (
  path TEXT, rule TEXT, line INTEGER, detail TEXT
);
CREATE INDEX IF NOT EXISTS ix_sym_path ON symbols(path);
CREATE INDEX IF NOT EXISTS ix_sym_name ON symbols(name);
CREATE INDEX IF NOT EXISTS ix_imp_path ON imports(path);
CREATE INDEX IF NOT EXISTS ix_imp_res  ON imports(resolved);
CREATE INDEX IF NOT EXISTS ix_sig_path ON signals(path);
CREATE INDEX IF NOT EXISTS ix_call_path ON calls(path);
"""


def open_db(cache_dir: str) -> sqlite3.Connection:
    os.makedirs(cache_dir, exist_ok=True)
    db = sqlite3.connect(os.path.join(cache_dir, "ir.db"))
    db.executescript(DDL)
    row = db.execute("SELECT v FROM meta WHERE k='schema'").fetchone()
    if row and int(row[0]) != SCHEMA_VERSION:
        for t in ("files", "symbols", "imports", "calls", "signals"):
            db.execute(f"DELETE FROM {t}")
    db.execute("INSERT OR REPLACE INTO meta VALUES ('schema',?)", (str(SCHEMA_VERSION),))
    db.commit()
    return db


# --------------------------------------------------------------------------
# extraction: symbols + imports
# --------------------------------------------------------------------------

JS_FUNC = re.compile(
    r"^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)", re.M)
JS_ARROW = re.compile(
    r"^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=][^=\n]*?=>", re.M)
JS_CLASS = re.compile(r"^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)", re.M)
JS_METHOD = re.compile(r"^\s{2,}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{", re.M)
JS_IMPORT = re.compile(r"""^\s*import\s+(?:[\w*{},\s$]+\s+from\s+)?['"]([^'"]+)['"]""", re.M)
JS_REQUIRE = re.compile(r"""require\(\s*['"]([^'"]+)['"]\s*\)""")
JS_DYNIMPORT = re.compile(r"""\bimport\(\s*['"]([^'"]+)['"]\s*\)""")

PY_DEF = re.compile(r"^(\s*)def\s+([A-Za-z_]\w*)", re.M)
PY_CLASS = re.compile(r"^class\s+([A-Za-z_]\w*)", re.M)
PY_IMPORT = re.compile(r"^\s*(?:from\s+([.\w]+)\s+import|import\s+([.\w]+))", re.M)

GO_FUNC = re.compile(r"^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)", re.M)
GO_IMPORT = re.compile(r'"([^"]+)"')

GENERIC_FUNC = {
    "java": re.compile(r"^\s*(?:public|private|protected).*?\s([A-Za-z_]\w*)\s*\([^)]*\)\s*\{", re.M),
    "csharp": re.compile(r"^\s*(?:public|private|protected|internal).*?\s([A-Za-z_]\w*)\s*\([^)]*\)", re.M),
    "rust": re.compile(r"^\s*(?:pub\s+)?fn\s+([A-Za-z_]\w*)", re.M),
    "ruby": re.compile(r"^\s*def\s+([A-Za-z_]\w*[?!]?)", re.M),
    "php": re.compile(r"^\s*(?:public|private|protected|\s)*function\s+([A-Za-z_]\w*)", re.M),
    "kotlin": re.compile(r"^\s*(?:private|public|internal\s+)?fun\s+([A-Za-z_]\w*)", re.M),
    "swift": re.compile(r"^\s*(?:private|public|internal\s+)?func\s+([A-Za-z_]\w*)", re.M),
    "dart": re.compile(r"^\s*(?:[A-Za-z_<>,\s]+\s+)?([A-Za-z_]\w*)\s*\([^)]*\)\s*(?:async\s*)?\{", re.M),
}

VUE_SVELTE_IMPORT = JS_IMPORT
CSS_IMPORT = re.compile(r"""@import\s+(?:url\()?['"]([^'"]+)['"]""")


def line_of(text: str, pos: int) -> int:
    return text.count("\n", 0, pos) + 1


def extract_symbols(lang: str, text: str) -> list[tuple[str, str, int, str]]:
    out: list[tuple[str, str, int, str]] = []

    def add(rx, kind):
        for m in rx.finditer(text):
            name = m.group(m.lastindex or 1)
            if name:
                out.append((name, kind, line_of(text, m.start()), m.group(0).strip()[:160]))

    if lang in ("javascript", "typescript", "vue", "svelte"):
        add(JS_FUNC, "function")
        add(JS_ARROW, "function")
        add(JS_CLASS, "class")
        for m in JS_METHOD.finditer(text):
            n = m.group(1)
            if n in ("if", "for", "while", "switch", "catch", "return", "function"):
                continue
            out.append((n, "method", line_of(text, m.start()), m.group(0).strip()[:160]))
    elif lang == "python":
        for m in PY_DEF.finditer(text):
            kind = "function" if not m.group(1) else "method"
            out.append((m.group(2), kind, line_of(text, m.start()), m.group(0).strip()[:160]))
        add(PY_CLASS, "class")
    elif lang == "go":
        add(GO_FUNC, "function")
    elif lang in GENERIC_FUNC:
        add(GENERIC_FUNC[lang], "function")

    # dedupe on (name, line)
    seen, dedup = set(), []
    for s in out:
        k = (s[0], s[2])
        if k not in seen:
            seen.add(k)
            dedup.append(s)
    return dedup


def extract_imports(lang: str, text: str) -> list[tuple[str, int]]:
    out = []
    if lang in ("javascript", "typescript", "vue", "svelte"):
        for rx in (JS_IMPORT, JS_REQUIRE, JS_DYNIMPORT):
            for m in rx.finditer(text):
                out.append((m.group(1), line_of(text, m.start())))
    elif lang == "python":
        for m in PY_IMPORT.finditer(text):
            out.append((m.group(1) or m.group(2), line_of(text, m.start())))
    elif lang == "go":
        block = re.search(r"import\s*\((.*?)\)", text, re.S)
        if block:
            for m in GO_IMPORT.finditer(block.group(1)):
                out.append((m.group(1), line_of(text, block.start() + m.start())))
        for m in re.finditer(r'^import\s+"([^"]+)"', text, re.M):
            out.append((m.group(1), line_of(text, m.start())))
    elif lang == "css":
        for m in CSS_IMPORT.finditer(text):
            out.append((m.group(1), line_of(text, m.start())))
    return out


JS_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".vue", ".svelte", ".css", ".scss"]


def resolve_import(raw: str, from_path: str, known: set[str], root: str) -> str | None:
    """Resolve to a repo-relative path, or None if external/unresolvable."""
    if raw.startswith("."):
        base = os.path.normpath(os.path.join(os.path.dirname(from_path), raw)).replace(os.sep, "/")
        cands = [base] + [base + e for e in JS_EXTS] + [base + "/index" + e for e in JS_EXTS]
        for c in cands:
            if c in known:
                return c
        return None
    # python dotted module
    dotted = raw.replace(".", "/")
    for c in (dotted + ".py", dotted + "/__init__.py"):
        if c in known:
            return c
    # tsconfig-style alias: @/foo, ~/foo, src/foo
    stripped = raw.lstrip("@~").lstrip("/")
    for prefix in ("", "src/", "app/", "lib/"):
        base = prefix + stripped
        for c in [base] + [base + e for e in JS_EXTS] + [base + "/index" + e for e in JS_EXTS]:
            if c in known:
                return c
    return None


# --------------------------------------------------------------------------
# role inference (deterministic, path+content based)
# --------------------------------------------------------------------------

ROLE_RULES = [
    ("test",       re.compile(r"(^|/)(__tests__|tests?|spec)/|\.(test|spec)\.[jt]sx?$|^test_|_test\.(py|go)$", re.I)),
    ("route",      re.compile(r"(^|/)(routes?|pages|app)/|router|\.route\.", re.I)),
    ("controller", re.compile(r"controller", re.I)),
    ("service",    re.compile(r"(service|usecase|domain)", re.I)),
    ("repository", re.compile(r"(repositor|dao|models?|entit)", re.I)),
    ("component",  re.compile(r"(^|/)(components?|views?|screens?|widgets?)/", re.I)),
    ("style",      re.compile(r"\.(css|scss|sass|less)$", re.I)),
    ("config",     re.compile(r"(^|/)(config|settings)|\.(json|ya?ml|toml)$", re.I)),
]


def infer_role(rel: str, lang: str, text: str) -> str:
    for role, rx in ROLE_RULES:
        if rx.search(rel):
            return role
    if lang in ("javascript", "typescript") and re.search(r"return\s*\(?\s*<", text):
        return "component"
    return "module"


# --------------------------------------------------------------------------
# UI / UX signal extraction  (facts only — no judgement here)
# --------------------------------------------------------------------------

SIGNAL_RULES: list[tuple[str, re.Pattern]] = [
    # data fetching & feedback states
    ("net.call",          re.compile(r"\b(fetch\(|axios\.|\.get\(|\.post\(|\.put\(|\.delete\(|useQuery\(|useMutation\(|http\.)")),
    ("state.loading",     re.compile(r"\b(isLoading|loading|isPending|pending|isFetching|busy|Spinner|Skeleton|ActivityIndicator)\b", re.I)),
    ("state.error",       re.compile(r"(?:\bisError\b|\bonError\b|\bcatch\s*\(|\berror(?:State|Message)?\b|\bErrorBoundary\b|\btoast\.error\b|\bsetError\b)", re.I)),
    ("state.success",     re.compile(r"\b(onSuccess|isSuccess|toast\.success|showSuccess|succeeded)\b", re.I)),
    ("state.empty",       re.compile(r"\b(emptyState|EmptyState|noResults|isEmpty|length\s*===\s*0)\b")),
    ("action.retry",      re.compile(r"\b(retry|refetch|tryAgain|reload)\b", re.I)),

    # destructive actions & confirmation
    ("action.destructive", re.compile(r"\b(delete|destroy|remove|revoke|purge|wipe|cancelSubscription)[A-Z_(]", )),
    ("guard.confirm",      re.compile(r"(?:\bconfirm\s*\(|\bConfirmDialog\b|\bAlertDialog\b|\bareYouSure\b|\bconfirmation\b|\bwindow\.confirm)", re.I)),

    # responsive
    ("resp.mediaquery",   re.compile(r"@media[^{]*\((?:min|max)-width")),
    ("resp.tw_breakpoint", re.compile(r"\b(sm|md|lg|xl|2xl):[a-z\-]")),
    ("resp.viewport_meta", re.compile(r"""<meta[^>]+name=["']viewport["']""")),
    ("resp.fixed_px",     re.compile(r"(?:min-)?[wW]idth\s*:\s*['\"]?(\d{3,})px")),
    ("resp.fixed_tw",     re.compile(r"\bw-\[(\d{3,})px\]")),
    ("resp.nowrap",       re.compile(r"white-space\s*:\s*nowrap|\bwhitespace-nowrap\b")),
    ("resp.overflow_x",   re.compile(r"overflow-x\s*:\s*(auto|scroll)|\boverflow-x-(auto|scroll)\b")),
    ("resp.vw_unit",      re.compile(r"\b100vw\b")),

    # structure / cognitive load
    ("ui.table_header",   re.compile(r"<(th|TableHead|Th)\b")),
    ("ui.form_field",     re.compile(r"<(input|Input|select|Select|textarea|TextArea|TextField)\b")),
    ("ui.button",         re.compile(r"<(button|Button|Pressable|TouchableOpacity)\b")),
    ("ui.heading",        re.compile(r"<h[1-6]\b|<Heading\b")),
    ("ui.aria_label",     re.compile(r"\baria-label|accessibilityLabel")),
    ("ui.nav_link",       re.compile(r"<(Link|NavLink|a)\b")),
    ("ui.modal",          re.compile(r"<(Modal|Dialog|Drawer|Sheet)\b")),

    # touch targets — small fixed heights on interactive elements
    ("ui.small_target",   re.compile(r"\b(h-[1-5]|height\s*:\s*(1[0-9]|2[0-3])px)\b")),
]


def extract_signals(lang: str, text: str) -> list[tuple[str, int, str]]:
    if lang not in UI_LANGS:
        return []
    out = []
    for rule, rx in SIGNAL_RULES:
        for m in rx.finditer(text):
            detail = (m.group(1) if m.groups() and m.group(1) else m.group(0))[:80]
            out.append((rule, line_of(text, m.start()), detail))
    return out


# --------------------------------------------------------------------------
# indexing
# --------------------------------------------------------------------------

def cmd_index(args):
    root = os.path.abspath(args.root)
    db = open_db(args.cache)
    t0 = time.time()

    on_disk = {}
    for rel, full, st in walk_repo(root, args.ignore or []):
        on_disk[rel] = (full, st)

    cached = {r[0]: (r[1], r[2]) for r in db.execute("SELECT path, sha1, mtime FROM files")}

    gone = set(cached) - set(on_disk)
    for p in gone:
        for t in ("files", "symbols", "imports", "calls", "signals"):
            db.execute(f"DELETE FROM {t} WHERE path=?", (p,))

    changed, unchanged = [], 0
    for rel, (full, st) in on_disk.items():
        prev = cached.get(rel)
        if prev and abs(prev[1] - st.st_mtime) < 1e-6 and not args.force:
            unchanged += 1
            continue
        digest = sha1_of(full)
        if prev and prev[0] == digest and not args.force:
            db.execute("UPDATE files SET mtime=? WHERE path=?", (st.st_mtime, rel))
            unchanged += 1
            continue
        changed.append((rel, full, st, digest))

    known_paths = set(on_disk)

    for rel, full, st, digest in changed:
        lang = LANG_BY_EXT[os.path.splitext(rel)[1].lower()]
        try:
            text = open(full, "r", encoding="utf-8", errors="ignore").read()
        except OSError:
            continue
        for t in ("files", "symbols", "imports", "calls", "signals"):
            db.execute(f"DELETE FROM {t} WHERE path=?", (rel,))
        role = infer_role(rel, lang, text)
        db.execute("INSERT INTO files VALUES (?,?,?,?,?,?)",
                   (rel, lang, digest, st.st_mtime, text.count("\n") + 1, role))
        db.executemany("INSERT INTO symbols VALUES (?,?,?,?,?)",
                       [(rel, n, k, ln, sg) for n, k, ln, sg in extract_symbols(lang, text)])
        imps = []
        for raw, ln in extract_imports(lang, text):
            res = resolve_import(raw, rel, known_paths, root)
            imps.append((rel, raw, res, ln, 0 if res else 1))
        db.executemany("INSERT INTO imports VALUES (?,?,?,?,?)", imps)
        db.executemany("INSERT INTO signals VALUES (?,?,?,?)",
                       [(rel, r, ln, d) for r, ln, d in extract_signals(lang, text)])

    db.commit()

    # second pass: re-resolve previously-unresolved imports now that all files are known
    db.execute("UPDATE imports SET resolved=NULL WHERE resolved NOT IN (SELECT path FROM files)")
    db.commit()

    report = {
        "root": root,
        "files_indexed": len(on_disk),
        "reparsed": len(changed),
        "unchanged": unchanged,
        "removed": len(gone),
        "symbols": db.execute("SELECT COUNT(*) FROM symbols").fetchone()[0],
        "edges": db.execute("SELECT COUNT(*) FROM imports WHERE external=0").fetchone()[0],
        "signals": db.execute("SELECT COUNT(*) FROM signals").fetchone()[0],
        "elapsed_s": round(time.time() - t0, 2),
    }
    emit(report, args)


# --------------------------------------------------------------------------
# graph
# --------------------------------------------------------------------------

def build_graph(db) -> tuple[dict, dict]:
    out, inn = defaultdict(set), defaultdict(set)
    for src, dst in db.execute("SELECT path, resolved FROM imports WHERE resolved IS NOT NULL"):
        if src != dst:
            out[src].add(dst)
            inn[dst].add(src)
    return out, inn


def find_cycles(out: dict) -> list[list[str]]:
    color, stack, cycles = {}, [], []
    seen_sets = set()

    def visit(n):
        color[n] = 1
        stack.append(n)
        for m in sorted(out.get(n, ())):
            c = color.get(m, 0)
            if c == 0:
                visit(m)
            elif c == 1:
                cyc = stack[stack.index(m):] + [m]
                key = frozenset(cyc)
                if key not in seen_sets:
                    seen_sets.add(key)
                    cycles.append(cyc)
        stack.pop()
        color[n] = 2

    for n in sorted(out):
        if color.get(n, 0) == 0:
            visit(n)
    return cycles


LAYER_ORDER = ["route", "controller", "service", "repository"]


def layering_violations(db, out: dict) -> list[dict]:
    roles = dict(db.execute("SELECT path, role FROM files"))
    viol = []
    for src, dsts in out.items():
        rs = roles.get(src)
        if rs not in LAYER_ORDER:
            continue
        i = LAYER_ORDER.index(rs)
        for d in dsts:
            rd = roles.get(d)
            if rd in LAYER_ORDER:
                j = LAYER_ORDER.index(rd)
                if j < i:
                    viol.append({"from": src, "from_layer": rs, "to": d, "to_layer": rd,
                                 "note": "lower layer imports a higher layer"})
                elif j > i + 1:
                    viol.append({"from": src, "from_layer": rs, "to": d, "to_layer": rd,
                                 "note": "layer skipped"})
    return viol


def cmd_graph(args):
    db = open_db(args.cache)
    out, inn = build_graph(db)
    result = {
        "nodes": db.execute("SELECT COUNT(*) FROM files").fetchone()[0],
        "edges": sum(len(v) for v in out.values()),
    }
    if args.cycles or args.all:
        result["cycles"] = [{"length": len(c) - 1, "path": c} for c in find_cycles(out)]
    if args.layers or args.all:
        result["layering_violations"] = layering_violations(db, out)
    if args.hubs or args.all:
        fan = sorted(((len(inn.get(p, ())), p) for p, in db.execute("SELECT path FROM files")),
                     reverse=True)[:15]
        result["most_depended_on"] = [{"path": p, "dependents": n} for n, p in fan if n]
    if args.of:
        result["of"] = {
            "file": args.of,
            "imports": sorted(out.get(args.of, ())),
            "imported_by": sorted(inn.get(args.of, ())),
        }
    emit(result, args)


# --------------------------------------------------------------------------
# signal synthesis -> findings
# --------------------------------------------------------------------------

def sig_map(db, paths=None) -> dict[str, dict[str, list[int]]]:
    q = "SELECT path, rule, line FROM signals"
    rows = db.execute(q).fetchall()
    m: dict[str, dict[str, list[int]]] = defaultdict(lambda: defaultdict(list))
    for p, r, ln in rows:
        if paths is None or p in paths:
            m[p][r].append(ln)
    return m


def clamp(x): return max(0.05, min(0.97, round(x, 2)))


def synthesize_findings(db, paths=None) -> list[dict]:
    """Turn raw signals into findings. Each finding states the pattern observed,
    the potential consequence, and a confidence derived from corroborating and
    contradicting evidence — never an assertion that the UI is broken."""
    findings = []
    roles = dict(db.execute("SELECT path, role FROM files"))
    project_has_breakpoints = db.execute(
        "SELECT COUNT(*) FROM signals WHERE rule IN ('resp.mediaquery','resp.tw_breakpoint')"
    ).fetchone()[0] > 0

    for path, s in sig_map(db, paths).items():
        def has(r): return r in s and len(s[r]) > 0
        def n(r): return len(s.get(r, []))

        # --- feedback gap -------------------------------------------------
        if has("net.call"):
            missing = [k for k in ("state.loading", "state.error") if not has(k)]
            if missing:
                conf = 0.45 + 0.15 * len(missing)
                if roles.get(path) == "component":
                    conf += 0.1
                if has("state.success"):
                    conf -= 0.05
                findings.append({
                    "rule": "ux.feedback_gap",
                    "severity": "medium",
                    "file": path, "line": s["net.call"][0],
                    "pattern": f"{n('net.call')} network call site(s) with no observable "
                               + " or ".join(x.split('.')[1] for x in missing) + " state",
                    "potential_consequence": "During the request the user may get no indication "
                                             "that anything is happening, or no way to tell that it failed.",
                    "evidence": [f"net.call x{n('net.call')} at lines {s['net.call'][:4]}"]
                                + [f"no `{m}` signal in file" for m in missing],
                    "confidence": clamp(conf),
                    "verify": "Open the screen and trigger the request on a slow connection.",
                })

        # --- unconfirmed destructive action -------------------------------
        presentational = roles.get(path) in ("component", "route") or has("ui.button")
        if presentational and has("action.destructive") and not has("guard.confirm"):
            conf = 0.55 + (0.15 if has("ui.button") else 0)
            findings.append({
                "rule": "ux.unconfirmed_destructive",
                "severity": "high",
                "file": path, "line": s["action.destructive"][0],
                "pattern": f"destructive operation(s) at lines {s['action.destructive'][:4]} "
                           "with no confirmation guard in the same file",
                "potential_consequence": "A single mis-tap may destroy data with no undo path.",
                "evidence": [f"action.destructive: {s['action.destructive'][:4]}",
                             "no confirm/AlertDialog signal in file"],
                "confidence": clamp(conf),
                "verify": "Confirmation may live in a parent or a shared hook — check the caller.",
            })

        # --- no recovery path after error ---------------------------------
        if has("state.error") and has("net.call") and not has("action.retry"):
            findings.append({
                "rule": "ux.no_recovery_path",
                "severity": "low",
                "file": path, "line": s["state.error"][0],
                "pattern": "error state is rendered but no retry/refetch affordance was found",
                "potential_consequence": "The user is told something failed but has no way "
                                         "forward except reloading the page.",
                "evidence": [f"state.error at {s['state.error'][:3]}", "no action.retry signal"],
                "confidence": 0.6,
                "verify": "Check whether retry is offered by a global error boundary.",
            })

        # --- responsive: wide table ---------------------------------------
        cols = n("ui.table_header")
        if cols >= 6:
            conf = 0.45 + min(0.3, 0.04 * (cols - 6))
            if has("resp.fixed_px") or has("resp.fixed_tw"):
                conf += 0.18
            if has("resp.nowrap"):
                conf += 0.08
            if has("resp.overflow_x"):
                conf -= 0.25
            if has("resp.tw_breakpoint") or has("resp.mediaquery"):
                conf -= 0.15
            if conf > 0.45:
                findings.append({
                    "rule": "resp.table_overflow_risk",
                    "severity": "medium",
                    "file": path, "line": s["ui.table_header"][0],
                    "pattern": f"table with {cols} columns"
                               + (" and fixed widths" if has("resp.fixed_px") or has("resp.fixed_tw") else "")
                               + (" and no responsive transformation" if not (has("resp.tw_breakpoint") or has("resp.mediaquery")) else ""),
                    "potential_consequence": "At ~375px viewport width some columns may require "
                                             "horizontal scrolling to reach.",
                    "evidence": [f"{cols} header cells",
                                 f"fixed-width declarations at lines: {(s.get('resp.fixed_px') or s.get('resp.fixed_tw') or ['none'])[:3]}",
                                 f"overflow-x present: {has('resp.overflow_x')}",
                                 f"breakpoints in file: {has('resp.tw_breakpoint') or has('resp.mediaquery')}"],
                    "confidence": clamp(conf),
                    "verify": "Render at 375px and check which columns fall off.",
                })

        # --- responsive: fixed width containers ---------------------------
        wide = [int(x) for x in
                (d for (d,) in db.execute(
                    "SELECT detail FROM signals WHERE path=? AND rule IN ('resp.fixed_px','resp.fixed_tw')",
                    (path,)) ) if str(x).isdigit()]
        wide = [w for w in wide if w >= 420]
        if wide and not (has("resp.mediaquery") or has("resp.tw_breakpoint")):
            findings.append({
                "rule": "resp.fixed_width_container",
                "severity": "medium",
                "file": path, "line": (s.get("resp.fixed_px") or s.get("resp.fixed_tw"))[0],
                "pattern": f"fixed width(s) of {sorted(set(wide))[:5]}px with no breakpoint in this file",
                "potential_consequence": "Content wider than the smallest common viewport (375px) "
                                         "can push the layout sideways.",
                "evidence": [f"widths {sorted(set(wide))[:5]}",
                             f"project defines breakpoints elsewhere: {project_has_breakpoints}"],
                "confidence": clamp(0.7 if not project_has_breakpoints else 0.55),
                "verify": "Check for a global container or breakpoint in the stylesheet.",
            })

        # --- cognitive load: long form ------------------------------------
        fields = n("ui.form_field")
        if fields >= 10:
            conf = 0.5 + min(0.25, 0.02 * (fields - 10))
            if n("ui.heading") >= 2:
                conf -= 0.15   # sectioning reduces load
            findings.append({
                "rule": "ux.cognitive_load_form",
                "severity": "low",
                "file": path, "line": s["ui.form_field"][0],
                "pattern": f"{fields} input fields in one file with {n('ui.heading')} heading(s) for grouping",
                "potential_consequence": "A long unsegmented form raises abandonment; users lose "
                                         "track of how much is left.",
                "evidence": [f"fields: {fields}", f"headings: {n('ui.heading')}",
                             f"steps/sections detected: {n('ui.heading')}"],
                "confidence": clamp(conf),
                "verify": "Check whether the form is split into steps at runtime.",
            })

        # --- too many simultaneous actions ---------------------------------
        if n("ui.button") >= 8:
            findings.append({
                "rule": "ux.action_density",
                "severity": "low",
                "file": path, "line": s["ui.button"][0],
                "pattern": f"{n('ui.button')} interactive controls rendered from one file",
                "potential_consequence": "Unclear primary action; the user has to read every "
                                         "control to decide what to do next.",
                "evidence": [f"buttons/pressables: {n('ui.button')}"],
                "confidence": 0.45,
                "verify": "Look at whether one action is visually dominant.",
            })

        # --- accessibility: unlabelled controls ----------------------------
        if n("ui.button") >= 3 and not has("ui.aria_label"):
            findings.append({
                "rule": "a11y.missing_labels",
                "severity": "low",
                "file": path, "line": s["ui.button"][0],
                "pattern": f"{n('ui.button')} controls, no aria-label/accessibilityLabel anywhere in file",
                "potential_consequence": "Icon-only controls may be unreachable by screen reader users.",
                "evidence": [f"controls: {n('ui.button')}", "aria-label signals: 0"],
                "confidence": 0.4,
                "verify": "Only matters for controls without visible text.",
            })

    findings.sort(key=lambda f: (-{"high": 3, "medium": 2, "low": 1}[f["severity"]], -f["confidence"]))
    return findings


def cmd_signals(args):
    db = open_db(args.cache)
    paths = set(args.files) if args.files else None
    f = synthesize_findings(db, paths)
    if args.min_confidence:
        f = [x for x in f if x["confidence"] >= args.min_confidence]
    emit({"findings": f, "count": len(f)}, args)


# --------------------------------------------------------------------------
# progressive context expansion
# --------------------------------------------------------------------------

def git_changed(root: str, base: str) -> list[str]:
    try:
        r = subprocess.run(["git", "-C", root, "diff", "--name-only", base],
                           capture_output=True, text=True, timeout=20)
        if r.returncode == 0:
            return [l.strip() for l in r.stdout.splitlines() if l.strip()]
    except Exception:
        pass
    return []


def cmd_context(args):
    db = open_db(args.cache)
    root = os.path.abspath(args.root)
    out, inn = build_graph(db)
    known = {r[0] for r in db.execute("SELECT path FROM files")}

    seeds = list(args.files or [])
    if args.changed:
        seeds += [p for p in git_changed(root, args.base) if p in known]
    seeds = [p for p in dict.fromkeys(seeds) if p in known]
    if not seeds:
        emit({"error": "no known changed files; pass --files or check --base"}, args)
        return

    level = args.level
    pack: dict = {"level": level, "changed": seeds}

    # L0 metadata
    meta = []
    for p in seeds:
        row = db.execute("SELECT lang, loc, role FROM files WHERE path=?", (p,)).fetchone()
        meta.append({"path": p, "lang": row[0], "loc": row[1], "role": row[2]})
    pack["files"] = meta

    # L1 symbols in changed files
    if level >= 1:
        syms = defaultdict(list)
        for p in seeds:
            for name, kind, ln in db.execute(
                    "SELECT name, kind, line FROM symbols WHERE path=? ORDER BY line", (p,)):
                syms[p].append(f"{kind} {name}:{ln}")
        pack["symbols"] = dict(syms)

    # L2 direct dependencies both ways
    if level >= 2:
        callers = sorted({c for p in seeds for c in inn.get(p, ())})
        callees = sorted({c for p in seeds for c in out.get(p, ())})
        pack["imported_by"] = callers[:args.max_neighbors]
        pack["imports"] = callees[:args.max_neighbors]

    # L3 affected flow: BFS outward, tagged by distance
    if level >= 3:
        dist = {p: 0 for p in seeds}
        q = deque(seeds)
        while q:
            cur = q.popleft()
            if dist[cur] >= args.depth:
                continue
            for nxt in out.get(cur, ()) | inn.get(cur, set()):
                if nxt not in dist:
                    dist[nxt] = dist[cur] + 1
                    q.append(nxt)
        flow = defaultdict(list)
        for p, d in sorted(dist.items(), key=lambda kv: (kv[1], kv[0])):
            if d:
                flow[f"distance_{d}"].append(p)
        pack["impact_radius"] = {k: v[:args.max_neighbors] for k, v in flow.items()}
        pack["impact_total"] = len(dist) - len(seeds)

    # L4 architectural context
    if level >= 4:
        roles = defaultdict(list)
        for p in list(dist if level >= 3 else seeds):
            r = db.execute("SELECT role FROM files WHERE path=?", (p,)).fetchone()
            if r:
                roles[r[0]].append(p)
        pack["layers_touched"] = {k: len(v) for k, v in roles.items()}
        cyc = [c for c in find_cycles(out) if set(c) & set(seeds)]
        if cyc:
            pack["cycles_involving_change"] = [c for c in cyc[:5]]
        lv = [v for v in layering_violations(db, out) if v["from"] in seeds or v["to"] in seeds]
        if lv:
            pack["layering_violations"] = lv[:10]

    # L5 full: include source of changed files + findings
    scope = set(seeds)
    if level >= 3:
        scope |= set(dist)
    pack["findings"] = synthesize_findings(db, scope)
    if level >= 5:
        src = {}
        for p in seeds:
            try:
                src[p] = open(os.path.join(root, p), "r", encoding="utf-8",
                              errors="ignore").read()[:args.max_bytes]
            except OSError:
                pass
        pack["source"] = src

    pack["approx_tokens"] = len(json.dumps(pack)) // 4
    emit(pack, args)


def cmd_stats(args):
    db = open_db(args.cache)
    by_lang = dict(db.execute("SELECT lang, COUNT(*) FROM files GROUP BY lang ORDER BY 2 DESC"))
    by_role = dict(db.execute("SELECT role, COUNT(*) FROM files GROUP BY role ORDER BY 2 DESC"))
    emit({
        "files": sum(by_lang.values()),
        "loc": db.execute("SELECT COALESCE(SUM(loc),0) FROM files").fetchone()[0],
        "by_language": by_lang,
        "by_role": by_role,
        "symbols": db.execute("SELECT COUNT(*) FROM symbols").fetchone()[0],
        "internal_edges": db.execute("SELECT COUNT(*) FROM imports WHERE external=0").fetchone()[0],
        "external_deps": db.execute(
            "SELECT COUNT(DISTINCT raw) FROM imports WHERE external=1").fetchone()[0],
        "ui_signals": db.execute("SELECT COUNT(*) FROM signals").fetchone()[0],
    }, args)


# --------------------------------------------------------------------------

def emit(obj, args):
    if getattr(args, "pretty", False):
        print(json.dumps(obj, indent=2))
    else:
        print(json.dumps(obj))


def main(argv=None):
    ap = argparse.ArgumentParser(prog="ci.py", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cache", default=".agents/skills/codebase-intelligence/cache")
    ap.add_argument("--pretty", action="store_true")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("index", help="build or refresh the IR cache")
    p.add_argument("root", nargs="?", default=".")
    p.add_argument("--force", action="store_true")
    p.add_argument("--ignore", action="append")
    p.set_defaults(fn=cmd_index)

    p = sub.add_parser("graph", help="dependency graph queries")
    p.add_argument("--cycles", action="store_true")
    p.add_argument("--layers", action="store_true")
    p.add_argument("--hubs", action="store_true")
    p.add_argument("--all", action="store_true")
    p.add_argument("--of", help="show edges for one file")
    p.set_defaults(fn=cmd_graph)

    p = sub.add_parser("signals", help="UI/UX/responsive findings")
    p.add_argument("--files", nargs="*")
    p.add_argument("--min-confidence", type=float, default=0.0)
    p.set_defaults(fn=cmd_signals)

    p = sub.add_parser("context", help="minimal context pack for changed code")
    p.add_argument("root", nargs="?", default=".")
    p.add_argument("--files", nargs="*")
    p.add_argument("--changed", action="store_true")
    p.add_argument("--base", default="HEAD~1")
    p.add_argument("--level", type=int, default=2, choices=range(0, 6))
    p.add_argument("--depth", type=int, default=2)
    p.add_argument("--max-neighbors", type=int, default=25)
    p.add_argument("--max-bytes", type=int, default=20000)
    p.set_defaults(fn=cmd_context)

    p = sub.add_parser("stats", help="what the index knows")
    p.set_defaults(fn=cmd_stats)

    args = ap.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
