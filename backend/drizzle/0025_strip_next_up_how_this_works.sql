-- Drop the "How this works" section from stored Next Up notes.
--
-- Next Up pages written between 2026-09-19 and 2026-10-21 end with a long
-- explanation of the ranking rules (config keys, score formula, Dataview).
-- It was replaced by the info popup next to "New topics" in 848c92d, and the
-- reader was meant to hide the stored copy, but the copies still reached
-- readers (seen on production). Removing it from the notes themselves means no
-- screen, stale client or Obsidian export can show it again.
--
-- Only when it is the last section, which it always was in those templates:
-- everything from its heading to the end of the note goes. A note with
-- another section after it is left untouched rather than guessed at.
-- mtime moves so clients holding a cached copy pick up the change.
UPDATE "notes"
SET
  "content" = rtrim(left("content", strpos("content", E'\n## How this works') - 1), E'\n ') || E'\n',
  "size_bytes" = octet_length(rtrim(left("content", strpos("content", E'\n## How this works') - 1), E'\n ') || E'\n'),
  "mtime" = now()
WHERE "path" LIKE '%/Next Up.md'
  AND strpos("content", E'\n## How this works') > 0
  AND strpos(substr("content", strpos("content", E'\n## How this works') + 1), E'\n## ') = 0;
