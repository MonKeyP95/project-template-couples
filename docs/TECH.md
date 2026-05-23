# TECH.md

## Current Technology Stack

- **Frontend**: Next.js 15 (App Router) + TypeScript
- **Styling**: Tailwind CSS
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth
- **ORM**: Drizzle ORM (for better type safety and complex queries)
- **AI & LLM Integration**: OpenAI (GPT-4o) or Anthropic Claude
- **API Integrations**: 
  - Google Calendar API
  - General web search (SerpAPI or Tavily)
  - Booking services (via external APIs where available)
- **Analytics**: Supabase + custom data collection tables
- **Deployment**: Vercel
- **State Management**: React hooks + Zustand (lightweight)

## Why This Stack?

- **Next.js 15**: Best foundation for both frontend and backend (API routes / Server Actions). Excellent for building AI features.
- **Supabase**: Still the best choice for fast development, auth, and real-time features (shared tasks, calendar, notes).
- **Drizzle ORM**: Gives us clean, type-safe database queries — important for data collection and analysis.
- **OpenAI / Claude**: Powers the AI chatbot and intelligent features (agenda creation, smart suggestions, web search assistance).
- **External APIs**: Easy to integrate Google Calendar and other services through Next.js API routes.
- **Scalable to Teams**: This structure supports multi-user workspaces and roles later without major rewrites.

## How This Stack Supports All Features

| Feature                          | How It Will Be Supported                     |
|----------------------------------|----------------------------------------------|
| User signup & Couple System      | Supabase Auth + custom couple table          |
| Shared Tasks, Calendar, Budget   | Supabase + Drizzle ORM                       |
| AI Chatbot                       | OpenAI/Claude API + streaming responses      |
| Agenda Creation                  | AI-powered (prompt engineering)              |
| Web Search / Booking             | Tavily or SerpAPI + AI agent logic           |
| Google Calendar Integration      | Google API + OAuth                           |
| Data Collection & Analysis       | Dedicated Supabase tables + queries          |
| Teams Version (Future)           | Workspaces + Row Level Security (RLS)        |

## Future Considerations
- May add **Shadcn/ui** for beautiful, accessible components
- May add **Zod** for strong form validation
- Possible transition to **Next.js Server Actions** heavily for AI features
- Monitoring: Vercel Analytics + Supabase logs

## Development Approach
- Build iteratively (one feature at a time)
- Keep AI features modular so they can be improved easily
- Strong focus on clean architecture because of AI + multiple integrations
