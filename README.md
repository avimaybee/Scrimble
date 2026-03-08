# Scrimble 🚀

Scrimble is an AI-powered project orchestration platform that helps you plan, track, and execute complex build processes. It breaks down high-level project goals into actionable steps, provides AI-enriched guidance for each task, and monitors progress through a visual canvas.

## Key Features

- **AI-Powered Planning**: Generate comprehensive project blueprints from a simple prompt using Gemini and other LLMs.
- **Visual Project Canvas**: Track your build progress with a clear, staged-based interface.
- **AI Step Enrichment**: Get detailed objectives, technical why-it-matters, and "done-when" criteria for every step.
- **Multi-Provider Support**: Seamlessly proxy requests through various AI models (Gemini, OpenAI, Anthropic).
- **Secure Authentication**: Firebase-backed user management and project privacy.
- **Edge-Ready API**: Powered by Hono and deployed via Cloudflare Pages and D1 database.

## Tech Stack

- **Frontend**: React 19, Vite, Tailwind CSS 4, Framer Motion
- **Routing**: React Router 7
- **State Management**: Zustand
- **Backend / API**: Hono (running on Cloudflare Pages Functions)
- **Database**: Cloudflare D1 (SQLite-based edge database)
- **Authentication**: Firebase Auth
- **AI Models**: Google Gemini (via `@google/genai`) and external proxies

## Getting Started

### Prerequisites

- Node.js (v18+)
- A Google AI SDK Key (Gemini)
- Firebase Project for Authentication
- Cloudflare Account (for D1/Pages deployment)

### Local Development

1. **Clone the repository**:
   ```bash
   git clone https://github.com/avimaybee/Scrimble.git
   cd Scrimble
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment**:
   Create a `.env` file (see `.env.example` for reference):
   ```env
   GEMINI_API_KEY=your_key_here
   VITE_FIREBASE_API_KEY=your_firebase_key
   ...
   ```

4. **Run the app**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

## Deployment

This app is designed to be deployed on **Cloudflare Pages**.

1. **Build the project**:
   ```bash
   npm run build
   ```

2. **Deploy via Wrangler**:
   ```bash
   npx wrangler pages deploy dist
   ```

> **Note**: Direct navigation / page refreshes on Cloudflare are supported via the `public/_redirects` file.

## License

This project is licensed under the Apache-2.0 License.

