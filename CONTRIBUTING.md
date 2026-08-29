# Contributing to CGV Shattershift

## Before starting

1. Pull the latest `main` branch.
2. Choose or create a small, clearly defined task.
3. Create a branch such as `feature/foundry-obstacles`, `fix/camera-collision`, or `docs/sprint-1`.

## While working

- Keep commits focused and use clear messages.
- Do not add uncredited models, textures, sounds, code, or tutorials.
- Record every external resource in the project credits register with its creator, source URL, licence, modifications, and where it is used.
- Keep asset filenames lowercase and hyphen-separated.
- Use relative paths so the production build works from a server subdirectory.
- Test through HTTP in Chrome; do not rely on opening `index.html` with a `file://` URL.
- Check that changes do not break restart, camera switching, or another level.

## Pull requests

1. Push your branch and open a pull request into `main`.
2. Describe what changed and how it was tested.
3. Add screenshots or a short recording for visible gameplay changes.
4. Ask at least one teammate to review it.
5. Resolve review comments before merging.

## Definition of done

A task is done when its acceptance test passes in Chrome, the console has no new errors, performance remains acceptable, external work is credited, and another teammate can understand the change.
