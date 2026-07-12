# Sentinel

Your daily command center. Consolidates emails, tasks, calendar, and reminders in one place.

## Features

- **Morning Brief** - Daily dashboard with key information at a glance
- **Email Management** - Surface flagged/reply-needed emails with approval workflow
- **Task Reminders** - Toggle reminders per task (5 min before + at start time)
- **Smart Unsubscribe** - Curated unsubscribe suggestions with approval-based workflow
- **Real-time Sync** - Integrates with Gmail, Google Calendar, and Structured

## Tech Stack

- **Frontend:** React 18 + Vite
- **Styling:** Tailwind CSS
- **Color Palette:** Navy (#1F3A54) + Copper (#D4944E)
- **Deployment:** Vercel

## Getting Started

### Prerequisites
- Node.js 16+
- npm or yarn

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

Opens at `http://localhost:3000`

### Build

```bash
npm run build
```

## Project Structure

```
src/
├── components/
│   ├── Layout.jsx          # Header, footer, layout wrapper
│   ├── MorningBrief.jsx    # Hero section with daily stats
│   ├── EmailSection.jsx    # Flagged/reply-needed emails
│   ├── TasksSection.jsx    # Today's tasks with reminder toggles
│   └── UnsubscribeSection.jsx # Unsubscribe suggestions
├── pages/                  # Page-level components (future)
├── hooks/                  # Custom React hooks (future)
├── context/                # React context for state (future)
├── App.jsx                 # Main app component
├── main.jsx                # React entry point
└── index.css               # Global styles
```

## Next Steps

1. Connect to Gmail MCP for real email data
2. Connect to Structured MCP for task data
3. Connect to Google Calendar MCP for meeting context
4. Build backend agent logic
5. Implement real reminder system (Apple Reminders API)
6. Add authentication layer
