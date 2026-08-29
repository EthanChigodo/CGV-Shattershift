# CGV Shattershift - Fracture Run

This repository contains the working concept and playable Three.js prototype for our Computer Graphics and Visualisation group project.

**Working game title:** Fracture Run  
**Repository name:** CGV Shattershift  
**Primary inspiration:** Smash Hit  
**Secondary inspiration:** Temple Run 2

The player automatically travels through a failing glass tower, throws limited energy spheres, avoids obstacles, and uses elevator transitions to reach three distinct sectors:

1. The Glass Causeway - first-person shooting and breakable routes.
2. The Shifting Foundry - third-person chase camera and moving machinery.
3. The Inverted Core - orbit camera, vertical gravity lanes, rotating rings, and the reactor finale.

## Controls

- `A` / `D` or left / right arrows: change lane.
- Mouse movement: aim.
- Left mouse button: throw a sphere.
- `C`: switch between first-person and chase cameras where applicable.
- `W` / `S` or up / down arrows: move between gravity heights in Level 3.
- `1`, `2`, `3`: jump directly to a level during a project demonstration.

## Play locally

The game uses JavaScript modules, so serve the folder over HTTP rather than double-clicking `index.html`.

### Python

Open a terminal in this folder and run:

```text
python -m http.server 4173
```

Then open `http://localhost:4173/` in Chrome.

If `python` is not recognised on Windows, try:

```text
py -m http.server 4173
```

Stop the server with `Ctrl+C`.

## Demo shortcuts

After selecting **Start Run**, press `1`, `2`, or `3` to jump directly to a level. These shortcuts are included for project demonstrations and development testing.

## Project documents

- [`docs/project-brief.md`](./docs/project-brief.md) - editable concept, level plan, rubric mapping, architecture, risks, and Sprint 1 backlog.
- [`docs/project-guide.pdf`](./docs/project-guide.pdf) - formatted PDF version of the project guide.

## Team workflow

Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) before making changes. In short: create a small branch for each task, commit focused changes, and open a pull request for another teammate to review.

## Sharing and deployment

### Quickest method

1. Download the repository as a ZIP or clone it with Git.
2. Each teammate extracts the archive.
3. They open a terminal in the extracted folder and use the local-server command above.
4. They open `http://localhost:4173/` in Chrome.

### GitHub Pages

1. In GitHub, open **Settings > Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select `main` and `/ (root)`, then save.
4. Share the Pages URL after GitHub finishes publishing.

### Department LAMP server

Upload the contents of the demo archive so that `index.html` is at the top level. The project uses relative local paths. It currently loads Three.js from an HTTPS CDN, so the marking browser must have Internet access. Before the final submission, the group should place a local copy of `three.module.js` in the project and update the import in `main.js` if fully offline operation is required.

## Current status

This is a concept prototype for discussing the game direction and demonstrating the planned mechanics. It is not yet the final assessed game. Models, detailed sound, a full menu/options system, production balancing, accessibility settings, and final performance work still need to be developed by the group.

## Technology

- Three.js and WebGL for rendering
- JavaScript for gameplay and state
- HTML/CSS for the interface
- Custom GLSL vertex and fragment shaders for the tower energy effect

No Unity or other game engine is used.
