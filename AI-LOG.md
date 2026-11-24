New-Item AI-LOG.md
code AI-LOG.md

## 1. Scaffolding
- **Asked:** How to scaffold a DeepSpace app.
- **AI said:** Run `npx deepspace`.
- **Problem:** That command is the CLI, not the scaffolder. It ran but created no folder.
- **Fix:** Used the correct command, `npm create deepspace@latest`, after the AI checked the docs.

## 2. PowerShell script error
- **Problem:** `npx` was blocked by Windows execution policy.
- **Fix:** Changed the execution policy for my user only.

## 3. Deploy failed: route_taken
- **Problem:** `my-app.app.space` was already taken.
- **Fix:** Used `npx deepspace deploy --rename`, committed the config change, redeployed. I found the rename option myself.

## 4. Rooms feature (Copilot)
- **Asked:** Rooms schema, page, owner-only edit and close. Followed the `items` example.
- **Copilot did:** `rooms-schema.ts`, `rooms.tsx`, registered the schema in `schemas.ts`, added nav in `nav.ts`.
- **I verified:** Created a room and saw it in the list. [Add the second-user test result here.]
- **I changed:** I removed the "don't touch other files" limit from the prompt, since registration and nav needed edits.

## 5. Copilot instructions file
- **Asked:** Claude chat for what to put in `.github/copilot-instructions.md`.
- **Decision:** Told Copilot to use DeepSpace primitives instead of writing its own, 
  to read the docs before using integrations, and to always pass 
  `claude-haiku-5-5` (the integration defaults to the expensive Opus model).
- **Why:** Copilot doesn't know DeepSpace, so it needs rules up front.

## 6. Docs correction
- **Problem:** The AI guessed a docs URL (`guides/integrations.md`) that doesn't exist.
- **Fix:** Fetched the docs index and found the real page, 
  `sdk-reference/client/integrations`. Updated the Copilot instructions.

## 7. Scope decision
- **Decision:** Core loop first (rooms, options, votes, AI summary), then 
  nearby places, forecast, and email, dropping from the bottom if time runs out.
- **Why:** Limited hours, and a finished core beats more half-working features.