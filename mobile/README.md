# /mobile — React Native Driver App

The Cruzonic driver app for iOS and Android. Drivers use this app to receive trip assignments, start/end trips, and transmit GPS location to the backend in real time.

## Tech Stack

- **Framework:** React Native (via Expo managed workflow)
- **Language:** TypeScript
- **Auth:** Supabase Auth (`@supabase/supabase-js`)
- **Navigation:** React Navigation v6
- **State:** Zustand
- **Maps / GPS:** `expo-location` + `react-native-maps`
- **Push Notifications:** Expo Notifications

## Folder Structure

```
mobile/
├── app/
│   ├── (auth)/          # Login / forgot password screens
│   ├── (tabs)/          # Bottom tab navigator screens
│   │   ├── home.tsx     # Current trip / idle status
│   │   ├── trips.tsx    # Trip history
│   │   └── profile.tsx  # Driver profile & settings
│   └── _layout.tsx      # Root layout with auth guard
├── components/          # Reusable UI components
├── hooks/               # Custom React hooks
├── services/
│   ├── supabase.ts      # Supabase client init
│   ├── api.ts           # Backend API calls
│   └── location.ts      # GPS tracking service
├── store/               # Zustand stores
├── types/               # Local type extensions
├── assets/              # Images, fonts
├── .env.example
├── app.json             # Expo config
├── package.json
└── tsconfig.json
```

## Setup

### 1. Install dependencies

```bash
cd mobile
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
EXPO_PUBLIC_API_URL=http://localhost:4000
```

> Note: React Native / Expo requires the `EXPO_PUBLIC_` prefix for variables to be accessible in the app bundle.

### 3. Start the Expo dev server

```bash
npx expo start
```

- Press `i` to open iOS Simulator
- Press `a` to open Android Emulator
- Scan the QR code with Expo Go on a physical device

### 4. Other commands

```bash
npx expo run:ios       # Native iOS build (requires macOS + Xcode)
npx expo run:android   # Native Android build (requires Android Studio)
npm run lint           # ESLint
npm run typecheck      # tsc --noEmit
```

## Authentication

Authentication uses **Supabase Auth** with email/password. The session is persisted using `expo-secure-store`. The root layout checks for a valid session on app start and redirects to the login screen if none exists.

## GPS Tracking

Location updates are sent to `POST /tracking` on the backend every 10 seconds while a trip is active. The `services/location.ts` service uses `expo-location`'s background location task to continue tracking even when the app is in the background.

Required permissions (declared in `app.json`):
- iOS: `NSLocationAlwaysAndWhenInUseUsageDescription`
- Android: `ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`

## Build & Distribution

Production builds are managed with **EAS Build**:

```bash
npm install -g eas-cli
eas build --platform all
eas submit --platform all
```

See `/docs/mobile-deployment.md` for the full EAS setup guide.
