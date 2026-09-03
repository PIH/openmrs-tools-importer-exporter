#!/usr/bin/env python3
"""Zip a directory hierarchy, preserving paths relative to the source directory."""

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
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", required=True, help="Root directory to archive")
    parser.add_argument("--output", required=True, help="Path to the .zip file to create")
    args = parser.parse_args()

    if not os.path.isdir(args.source_dir):
        parser.error(f"Source directory does not exist: {args.source_dir}")

    create_archive(args.source_dir, args.output)


if __name__ == "__main__":
    main()
