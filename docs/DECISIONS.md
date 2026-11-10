# DECISIONS

- **Modular monolith, plain PostgreSQL** – simple; no Supabase to avoid overlapping with the .NET backend.
- **.NET 9** – the version in use; upgrade to .NET 10 LTS is on the roadmap.
- **IMemoryCache first, Redis later** – add Redis only when running multiple instances.
- **PWA for desktop** – Tauri/Electron only if deep OS integration is needed.
- **ng-zorro, fallback PrimeNG** – switch if ng-zorro is incompatible with Angular 22.
- **State: Signals + SignalStore, RxJS for HTTP/streams** – RxJS is not used as a store.
