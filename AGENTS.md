# OIP Project Instructions

## Git workflow

- This repository is a personal project.
- Do not create branches or pull requests for routine changes.
- After completing any requested project change, do not wait for a separate publish request or confirmation.
- Do not use the `github:yeet` skill or its branch/PR workflow for publishing changes in this repository.
- Verify the intended changes, then publish with the simple sequence `git add`, `git commit`, and `git push origin main`.
- Commit directly to `main` and push to `origin/main` as the final step of the task.
- Only create a branch or pull request if the user explicitly overrides this rule for a specific task.
- Before pushing, verify that only the intended project changes are included and run relevant checks when appropriate.

## Verification workflow

- For routine changes, rely on relevant automated checks and do not run live/manual browser verification unless the user explicitly asks for it.
- The user will perform final real-world usage verification; after implementation and automated checks succeed, commit and push the change.

## Hosting workflow

- This project is hosted through Vercel from the GitHub `main` branch.
- Do not use OpenAI Sites hosting, Sites deployment tools, or a separate Sites source repository for this project.
- Publishing means pushing the verified commit to `origin/main` so the existing Vercel workflow can deploy it.
