# System Architecture

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Cruzonic Platform                       │
│                                                                 │
│  ┌──────────────┐        ┌──────────────────┐                  │
│  │ Driver App   │        │  Fleet Portal    │                  │
│  │ React Native │        │  React (Vite)    │                  │
│  │ iOS/Android  │        │  Web Browser     │                  │
│  └──────┬───────┘        └────────┬─────────┘                  │
│         │ HTTPS REST              │ HTTPS REST + Realtime      │
│         ▼                         ▼                             │
│  ┌──────────────────────────────────────────┐                  │
│  │          Express API Server               │                  │
│  │          Node.js / TypeScript             │                  │
│  │  ┌──────────┐  ┌──────────┐  ┌────────┐ │                  │
│  │  │  Auth    │  │  Trips   │  │Tracking│ │                  │
│  │  │ module   │  │  module  │  │ module │ │                  │
│  │  └──────────┘  └──────────┘  └────────┘ │                  │
│  └───────────────────────┬──────────────────┘                  │
│                          │ supabase-js (service role)          │
│                          ▼                                      │
│  ┌──────────────────────────────────────────┐                  │
│  │              Supabase Cloud               │                  │
│  │  ┌──────────────────┐  ┌──────────────┐  │                  │
│  │  │  PostgreSQL DB   │  │  Auth        │  │                  │
│  │  │  (tables + RLS)  │  │  (JWT)       │  │                  │
│  │  └──────────────────┘  └──────────────┘  │                  │
│  │  ┌──────────────────┐  ┌──────────────┐  │                  │
│  │  │  Realtime        │  │  Storage     │  │                  │
│  │  │  (location feed) │  │  (files)     │  │                  │
│  │  └──────────────────┘  └──────────────┘  │                  │
│  └──────────────────────────────────────────┘                  │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow — Trip Tracking

```mermaid
sequenceDiagram
    participant D as Driver App
    participant API as Express API
    participant DB as Supabase DB
    participant P as Fleet Portal

    D->>API: POST /trips (start trip)
    API->>DB: INSERT trips row (status=in_progress)
    API-->>D: { trip_id }

    loop Every 10 seconds
        D->>API: POST /tracking { lat, lng, speed }
        API->>DB: INSERT location_events row
        DB-->>P: Realtime event (new location)
        P->>P: Update vehicle marker on map
    end

    D->>API: PATCH /trips/:id (status=completed)
    API->>DB: UPDATE trips row
    API-->>D: { trip }
```

## Authentication Flow

```mermaid
sequenceDiagram
    participant C as Client (App/Portal)
    participant API as Express API
    participant SUP as Supabase Auth

    C->>API: POST /auth/login { email, password }
    API->>SUP: signInWithPassword()
    SUP-->>API: { access_token, refresh_token, user }
    API-->>C: { access_token, refresh_token, user }

    C->>API: GET /trips (Authorization: Bearer <token>)
    API->>SUP: getUser(token)
    SUP-->>API: { user }
    API-->>C: trips data
```
