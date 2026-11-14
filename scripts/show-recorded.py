import json, sys
for n in sys.argv[1:]:
    try: r=json.load(open(f"src/lib/recorded/{n}.json",encoding="utf8"))
    except Exception as e: print(n,"MISSING",e); continue
    print("=====",n, r["reader"]["status"], r["reader"].get("ms"), "guard", r["reader"].get("guardTripped"), r["counts"], "tests", r["stats"]["testCases"])
    for x in r["rules"]: print("  R",x["id"], x["status"], "|", x["note"][:150].encode("ascii","replace").decode(), "|", [e["label"][:38] for e in x["evidence"]][:3])
    for c in r["claims"]: print("  C",c["status"], f'[{c["kind"]}]', c["quote"][:75].replace("\n"," ").encode("ascii","replace").decode(), "=>", c["note"][:95], "|", [e["label"][:40]+" :: "+(e.get("detail") or "")[:60] for e in c["evidence"]][:1])
    print("  N",r["notes"][:2])
