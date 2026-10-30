# MCP Travel Agent Port

This is a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that gives any MCP client (Claude Code, Claude Desktop, the MCP Inspector, and so on) the travel-planning tools from my [Travel Agent](https://github.com/1214443427/travel-agent) app.

The original app is a Next.js project in which agents built with OpenAI's Agents SDK check the weather, search for flights and hotels, and find attractions, then present a finished trip plan. In that app, the agents and their tools live inside the Next.js backend. This port moves the tools into a standalone MCP server, so that any MCP-capable model can use them to plan a trip.

## What the server exposes

### Tools

| Tool               | Description                                                                                                                                                            | Data source               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `get_lat_lon`      | Returns the latitude and longitude of a city, optionally narrowed by ISO country code.                                                                                 | OpenWeather Geocoding     |
| `get_weather`      | Returns the current weather and temperature at a location, in metric or imperial units.                                                                                | OpenWeather               |
| `get_flights`      | Searches for outbound flights between two airports (IATA codes) for a round trip. Returns up to 3 options, each with a `ref` such as `flt_0`.                          | Google Flights (RapidAPI) |
| `get_next_flights` | Takes the `ref` of an outbound flight and returns the matching return flights, with the exact round-trip price.                                                        | Google Flights (RapidAPI) |
| `get_hotels`       | Returns up to 5 hotels near a location for the given dates and number of guests, each with a `ref` such as `htl_3`. The price is the all-inclusive total for the stay. | Booking.com (RapidAPI)    |
| `get_attractions`  | Returns up to 10 named tourist attractions within 10 km of a location, including the Wikipedia page when one exists.                                                   | Geoapify Places           |

As in the original app, each tool trims the API response down to the fields a model needs, to save tokens and context.

### Prompts

- `plan_trip`: takes a destination, start location, start date, end date, and budget (in USD), and asks the model to draft a plain-text itinerary covering weather, transportation, accommodation, and activities.

## Booking refs

Flight and hotel APIs identify results with long, random tokens. As in the original app, the model never sees these tokens, because it could hallucinate ones that don't exist. Instead, the server stores each token and gives the model a short `ref`:

1. `get_flights` stores each outbound flight's `next_token` under a ref like `flt_0`.
2. `get_next_flights` takes that ref, looks up the token, and fetches the return flights. Each return flight's `booking_token` is stored under a new ref.
3. `get_hotels` stores each hotel's ID, together with the dates and number of guests it searched for, under a ref like `htl_3`.

Refs are kept in memory, belong to the user who created them, and expire after 30 minutes.

## Project structure

```
src/
├── index.ts     # MCP server: tools, resources, prompts, and the Express app
├── config.ts    # Loads and validates API keys from .env
├── fetching.ts  # fetch wrappers with timeouts, RapidAPI headers, and API key redaction in errors
├── type.ts      # Zod schemas for tool inputs and API responses
├── users.ts     # Sample user data served at /api/users
└── utils.ts     # URL building and schema validation helpers
```

API responses are validated with Zod before they are used. Lists of flights, hotels, and places are parsed item by item, so one malformed entry is dropped instead of failing the whole response.

## Getting started

### Prerequisites

- Node.js 20 or later
- API keys for:
  - [OpenWeather](https://openweathermap.org/api) (geocoding and current weather)
  - [RapidAPI](https://rapidapi.com), subscribed to the **Google Flights** (`google-flights2`) and **Booking.com** (`booking-com15`) APIs
  - [Geoapify](https://www.geoapify.com) (Places API)

### Installation

```bash
git clone <this-repo-url>
cd mcp-travel-agent-port
npm install
```

Create a `.env` file in the project root:

```env
WEATHER_API=your-openweather-key
RAPID_API_KEY=your-rapidapi-key
GEOAPIFY_KEY=your-geoapify-key
# Optional, defaults to 3000
PORT=3000
```

The server will not start if any of the three API keys is missing.

### Running

```bash
npm run build   # compile TypeScript to build/
npm start       # run the compiled server
```

For development, `npm run dev` runs the server with `tsx` and restarts it whenever a file changes. `npm run typecheck` checks the types without emitting files.

The server uses the Streamable HTTP transport and listens on `http://localhost:3000/mcp`. It binds to `127.0.0.1`, so it is only reachable from the local machine.

### Connecting a client

**Claude Code**

```bash
claude mcp add --transport http travel-agent http://localhost:3000/mcp
```

**MCP Inspector**

Start the server, then run the Inspector and connect to `http://localhost:3000/mcp` with the "Streamable HTTP" transport:

```bash
npx @modelcontextprotocol/inspector
```

Once connected, you can use the `plan_trip` prompt, or simply ask the model to plan a trip, for example: _"Plan a 5-day trip from SFO to Tokyo starting 2026-12-01 for two people with a $4000 budget."_

## User profiles and authentication

The Express app also serves a small sample user API at `/api/users` and `/api/users/:id`, which the `travel://me/profiles` resource reads from. The users are hard-coded in [src/users.ts](src/users.ts) for testing.

[src/index.ts](src/index.ts) contains a commented-out bearer-token verifier that maps development tokens (`dev-u1`, `dev-u2`) to those sample users. While it is disabled, every request is treated as anonymous: the profile resource reports that the user is not logged in, and all refs are owned by the same anonymous user.

## Differences from the original app

|                | Original Next.js app                                                                 | This MCP server                                                 |
| -------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Model          | Runs its own planner and formatter agents with the OpenAI Agents SDK                 | Uses whatever model the MCP client runs                         |
| Interface      | Mobile-first web UI with a trip form and progress streamed over SSE                  | Tools, resources, and prompts over MCP                          |
| Output         | Structured JSON trip plan rendered as cards                                          | Whatever the client's model writes                              |
| Booking        | `/api/flight`, `/api/book`, and `/api/hotel` endpoints redeem refs for booking links | Refs are created and stored, but there are no booking tools yet |
| Airport lookup | `searchAirport` tool                                                                 | Not ported; the model supplies IATA codes itself                |

## Acknowledgements

The original app's design and features are based on [Scrimba](https://scrimba.com)'s travel agent project.
