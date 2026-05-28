# Landa PANDA Tool

Prototype UI for a service-team early detection console for Landa Digital Printing machine logs.

## What is included

- React + Vite app
- Service Radar overview screen
- Full Landa-style machine digital twin with clickable system hotspots
- Active issue panel
- StateMachine timeline
- Evidence log
- Recommended service actions
- BSS Blanket System drill-down screen
- Component-level cutaway view with likely root-cause ranking

## Run locally

```bash
npm install
npm run dev
```

Then open the local URL shown by Vite.

## Build

```bash
npm run build
```

## Current scope

This is a front-end prototype using mocked data. The next step is to connect it to a backend parser that can ingest:

- `autocollect.zip`
- `opc.zip`
- `opc/logs/`

and normalize logs such as:

- StateMachine / MachineStates
- FECNotifications
- IPSNotifications
- ECCNotifications
- BSS logs
- AlertsMonitoring

The analysis logic should be state-aware: every signal is evaluated by Machine State, subsystem state, transition windows, duration, and dynamic expected bands.
