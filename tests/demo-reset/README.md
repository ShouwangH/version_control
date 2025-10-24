# Demo Reset Repository

This directory captures a pre-built vc-core repository that you can copy into `../demo` for interactive demos.

## Snapshot contents

- **Commit `c-8f1e7e46...`** – base: `note.txt` contains the original text.
- **Commit `c-1dd75372...`** – "ours": replaces the second line with `ours change`.
- **Commit `c-d604fd50...`** – "theirs": replaces the second line with `theirs change`.

After copying, the working state is left on the "ours" commit so you can immediately try merging the "theirs" commit to reproduce a conflict.

## Usage

```bash
# from tests/
rm -rf demo
cp -R demo-reset demo
```

Then run CLI commands inside `tests/demo` (or use the web client) to inspect and resolve the merge conflict.
