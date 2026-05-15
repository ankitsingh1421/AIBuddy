# Frontend

This is the frontend for the Vectra app.

It includes:
- chat UI
- conversation history
- sign in popup
- links and images tabs
- guest usage limit
- file and image upload from the input box

## Requirements

- Bun installed
- backend running on `http://localhost:5000`

## Install

```bash
bun install
```

## Run in Development

```bash
bun run dev
```

The frontend runs on:

```bash
http://localhost:3000
```

## Build

```bash
bun run build
```

## Production Run

```bash
bun run start
```

## Main Routes

- `/dashboard`
- `/c/:conversationId`

## Notes

- Logged-in users can save and reopen conversations.
- Guests can use local history in the browser.
- Guests can ask up to 5 questions before sign in is required.
