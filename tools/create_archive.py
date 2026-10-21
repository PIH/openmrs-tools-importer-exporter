#!/usr/bin/env python3
"""Zip a directory hierarchy, preserving paths relative to the source directory.

Usage:
    create_archive.py --source-dir <dir> --output <file.zip>

    --source-dir  Root directory to archive. Its *contents* are archived; the
                  directory itself is NOT included as a top-level entry.
    --output      Path of the .zip file to create.

Paths inside the archive are relative to --source-dir. For example, given:

    /opt/openmrs/complex_obs/2024/01/image1.jpg
    /opt/openmrs/complex_obs/2024/02/image2.jpg

running with "--source-dir /opt/openmrs/complex_obs" produces entries:

    2024/01/image1.jpg
    2024/02/image2.jpg

(no leading "complex_obs/"). When merging this archive with merge_extract.py,
pass the *equivalent* directory on the target server as --dest-dir (e.g.
"--dest-dir /opt/openmrs/complex_obs"), NOT its parent ("/opt/openmrs"),
otherwise the files will land one level too high.
"""

import argparse
import os
import zipfile


def create_archive(source_dir, output_path):
    source_dir = os.path.abspath(source_dir)
    file_count = 0
    total_size = 0

    with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _dirs, files in os.walk(source_dir):
            for filename in files:
                full_path = os.path.join(root, filename)
                rel_path = os.path.relpath(full_path, source_dir)
                zf.write(full_path, rel_path)
                file_count += 1
                total_size += os.path.getsize(full_path)

    print(f"Archived {file_count} file(s), {total_size} byte(s) total, into {output_path}")


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--source-dir", required=True, help="Root directory whose contents are archived (the directory itself is not included)")
    parser.add_argument("--output", required=True, help="Path to the .zip file to create")
    args = parser.parse_args()

    if not os.path.isdir(args.source_dir):
        parser.error(f"Source directory does not exist: {args.source_dir}")

    create_archive(args.source_dir, args.output)


if __name__ == "__main__":
    main()
