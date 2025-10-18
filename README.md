# Minecraft Social (Bedrock-style UI)

A minimal, responsive social network inspired by Minecraft Bedrock UI, designed for mobile and laptop. Users can sign up, log in, create posts with images, like, comment, and follow profiles.

## Features
- Auth: signup, login, logout (session-based)
- Feed: post text and images
- Social: likes, comments, follow/unfollow
- Profiles with avatars, bio
- Bedrock-inspired responsive UI

## Tech
- Node.js, Express
- EJS templates, vanilla CSS
- SQLite (file DB)
- Multer for uploads

## Quick start

```bash
npm install
npm run start
# open the URL the server prints, e.g. http://localhost:3000 or the provided port
```

Development with auto-reload:
```bash
npm run dev
```

## Environment
- `SESSION_SECRET` (optional). Defaults to a dev secret.

## Project structure
```
public/
  css/
  img/
uploads/
views/
  partials/
routes/
lib/
```

## Notes
- Uploaded avatars go to `public/img/avatars/`. Post images go to `public/img/posts/`.
- Database file is created at `data/app.db`.

## License
MIT
