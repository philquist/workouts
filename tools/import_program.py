#!/usr/bin/env python3
"""
import_program.py — parse the Markdown training program ("Workout Tracker -
Block #N ... .md") into data/program.json, which the web app loads so you can
pull a prescribed day's exercises into the logger with one tap.

Run after editing the program:

    python3 tools/import_program.py

Structure parsed:

    ## Week 79                         -> global training week (1..86)
    ### Monday - 5x10 - Day 1, Week 1  -> a session (day) in that week
    **B1) Back Squat 5x10** - 3/0/X/0  -> an exercise: code / name / scheme / tempo
    | Set | Weight | Reps | Notes |    -> set rows are counted as the set target
    | 1   |        |      | ... |
"""
import re, glob, json, os, hashlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

WEEK_RE = re.compile(r'^##\s+Week\s+(\d+)\b')
SESSION_RE = re.compile(r'^###\s+(.*\S)\s*$')
EX_RE = re.compile(r'^\*\*(.+?)\*\*\s*(?:-\s*(.+?))?\s*$')
TABLE_ROW_RE = re.compile(r'^\|\s*(\d+)\s*\|')          # a numbered set row
CODE_RE = re.compile(r'^([A-Z]\d?)\)\s*(.*)$')
TEMPO_RE = re.compile(r'^[\dX]+/[\dX]+/[\dX]+/[\dX]+$', re.I)
SCHEME_RE = re.compile(r'\s+(\d+\s*[xX]\s*[\d\-:]+\w*|[xX]\s*[\d\-:]+\w*)\s*$')


def sid(*parts):
    return hashlib.sha1('|'.join(str(p) for p in parts).encode()).hexdigest()[:10]


def block_of(filename):
    m = re.search(r'Block #(\d+)', filename)
    return int(m.group(1)) if m else None


def parse_exercise(inner, tail):
    """inner = text between **...**, tail = text after ' - ' (may be tempo)."""
    code = None
    m = CODE_RE.match(inner)
    if m:
        code, inner = m.group(1), m.group(2)

    tempo = None
    if tail and TEMPO_RE.match(tail.strip()):
        tempo = tail.strip()

    name = inner.strip()
    scheme = None
    m = SCHEME_RE.search(name)
    if m:
        scheme = m.group(1).strip()
        name = name[:m.start()].strip()

    name = name.rstrip(' :-').strip()
    return code, name, scheme, tempo


def sets_from_scheme(scheme):
    if not scheme:
        return None
    m = re.match(r'(\d+)\s*[xX]', scheme)
    return int(m.group(1)) if m else None


def main():
    files = sorted(glob.glob(os.path.join(ROOT, "*.md")))
    weeks = {}            # week number -> {week, block, sessions:[]}
    all_names = {}        # cleaned name -> count

    for path in files:
        base = os.path.basename(path)
        if "INDEX" in base:
            continue
        block = block_of(base)
        cur_week = None
        cur_session = None
        cur_ex = None

        with open(path, encoding="utf-8") as fh:
            for raw in fh:
                line = raw.rstrip('\n')

                m = WEEK_RE.match(line)
                if m:
                    wk = int(m.group(1))
                    cur_week = weeks.setdefault(wk, {"week": wk, "block": block, "sessions": []})
                    cur_session = None
                    cur_ex = None
                    continue

                if cur_week is None:
                    continue

                m = SESSION_RE.match(line)
                if m:
                    title = m.group(1)
                    day = title.split(' - ', 1)[0].strip()
                    cur_session = {
                        "id": sid(block, cur_week["week"], title),
                        "day": day,
                        "title": title,
                        "exercises": [],
                    }
                    cur_week["sessions"].append(cur_session)
                    cur_ex = None
                    continue

                if cur_session is None:
                    continue

                # set-count rows under the current exercise
                if cur_ex is not None and TABLE_ROW_RE.match(line):
                    cur_ex["_rows"] += 1
                    continue

                m = EX_RE.match(line)
                if m and line.startswith('**'):
                    code, name, scheme, tempo = parse_exercise(m.group(1), m.group(2))
                    if not name:
                        cur_ex = None
                        continue
                    cur_ex = {
                        "code": code,
                        "name": name,
                        "scheme": scheme,
                        "tempo": tempo,
                        "_rows": 0,
                    }
                    cur_session["exercises"].append(cur_ex)
                    all_names[name] = all_names.get(name, 0) + 1
                    continue

        # nothing else needed per line

    # finalize: compute set targets, drop helper keys, drop empty sessions
    out_weeks = []
    total_sessions = total_ex = 0
    for wk in sorted(weeks):
        w = weeks[wk]
        sessions = []
        for s in w["sessions"]:
            for ex in s["exercises"]:
                ex["sets"] = ex.pop("_rows") or sets_from_scheme(ex["scheme"]) or 1
            s["exercises"] = [e for e in s["exercises"] if e["name"]]
            if s["exercises"]:
                sessions.append(s)
                total_ex += len(s["exercises"])
        if sessions:
            w["sessions"] = sessions
            out_weeks.append(w)
            total_sessions += len(sessions)

    exercise_names = sorted(all_names, key=lambda n: (-all_names[n], n.lower()))

    program = {
        "weeks": out_weeks,
        "exerciseNames": exercise_names,
    }

    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    out_path = os.path.join(ROOT, "data", "program.json")
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(program, fh, separators=(",", ":"))

    summary = {
        "weeks": len(out_weeks),
        "sessions": total_sessions,
        "exercise_instances": total_ex,
        "distinct_exercise_names": len(exercise_names),
        "bytes": os.path.getsize(out_path),
        "sample_week": out_weeks[0]["week"] if out_weeks else None,
        "sample_session": out_weeks[0]["sessions"][0]["title"] if out_weeks else None,
        "top_names": exercise_names[:15],
    }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
