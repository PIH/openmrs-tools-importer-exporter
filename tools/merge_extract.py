#!/usr/bin/env python3
"""Extract a zip archive into an existing directory tree, merging non-destructively.

Missing subdirectories are created as needed. Existing destination files are
never overwritten; when a file already exists at the same relative path, the
archived copy is skipped and the conflict is recorded in a CSV log instead.

Usage:
    merge_extract.py --zip <file.zip> --dest-dir <dir> [--conflict-log <file.csv>]

    --zip           Archive to merge in (typically created by create_archive.py).
    --dest-dir      Existing directory to merge into. Archive entries are
                    extracted relative to this directory.
    --conflict-log  Path for the CSV report of skipped (already existing)
                    files. Defaults to "conflicts.csv" in the current directory;
                    only written if there are conflicts.

--dest-dir must be the directory that corresponds to the --source-dir used
when the archive was created, NOT its parent. create_archive.py stores paths
relative to --source-dir, without the source directory's own name. For example,
if the archive was created with:

    create_archive.py --source-dir /opt/openmrs/complex_obs --output obs.zip

its entries look like "2024/01/image1.jpg", so merge with:

    merge_extract.py --zip obs.zip --dest-dir /opt/openmrs/complex_obs

which yields /opt/openmrs/complex_obs/2024/01/image1.jpg. Passing
"--dest-dir /opt/openmrs" instead would wrongly yield
/opt/openmrs/2024/01/image1.jpg.

Tip: run "unzip -l <file.zip> | head" to check the archive's top-level layout
before merging.
"""

import argparse
import csv
import os
import zipfile
from datetime import datetime


def merge_extract(zip_path, dest_dir, conflict_log_path):
    dest_dir = os.path.abspath(dest_dir)
    extracted = 0
    conflicts = []

    with zipfile.ZipFile(zip_path, "r") as zf:
        for member in zf.infolist():
            if member.is_dir():
                continue

            rel_path = member.filename
            dest_path = os.path.join(dest_dir, rel_path)

            if os.path.exists(dest_path):
                stat = os.stat(dest_path)
                conflicts.append({
                    "relative_path": rel_path,
                    "destination_path": dest_path,
                    "destination_size": stat.st_size,
                    "destination_mtime": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                })
                continue

            os.makedirs(os.path.dirname(dest_path), exist_ok=True)
            with zf.open(member) as src, open(dest_path, "wb") as dst:
                dst.write(src.read())
            extracted += 1

    if conflicts:
        with open(conflict_log_path, "w", newline="") as f:
            writer = csv.DictWriter(
                f,
                fieldnames=["relative_path", "destination_path", "destination_size", "destination_mtime"],
            )
            writer.writeheader()
            writer.writerows(conflicts)

    print(f"Extracted {extracted} file(s) into {dest_dir}")
    if conflicts:
        print(f"Skipped {len(conflicts)} conflicting file(s) (already existed) — see {conflict_log_path}")
    else:
        print("No conflicts encountered")


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--zip", required=True, help="Archive to merge in")
    parser.add_argument("--dest-dir", required=True, help="Existing directory corresponding to the archive's original --source-dir (not its parent)")
    parser.add_argument("--conflict-log", default="conflicts.csv", help="Path for the CSV conflict report")
    args = parser.parse_args()

    if not os.path.isfile(args.zip):
        parser.error(f"Archive does not exist: {args.zip}")
    if not os.path.isdir(args.dest_dir):
        parser.error(f"Destination directory does not exist: {args.dest_dir}")

    merge_extract(args.zip, args.dest_dir, args.conflict_log)


if __name__ == "__main__":
    main()
