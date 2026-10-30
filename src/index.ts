#!/usr/bin/env node
import {
  CallToolResult,
  McpRequestContext,
  McpServer,
  OAuthError,
  OAuthErrorCode,
  OAuthTokenVerifier,
  ResourceTemplate,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import { constructUrl, parseData } from "./utils.js";
import {
  LatLonSchema,
  UserSchema,
  WeatherSchema,
  BookingHandle,
  FlightSchema,
  getFlightsParams,
  getNextFlightParams,
  getHotelsParams,
  HotelsSchema,
  HotelHandle,
  PlacesSchema,
} from "./type.js";
import { GEOAPIFY_KEY, WEATHER_API_KEY } from "./config.js";
import { fetchAPI, fetchRapidAPI } from "./fetching.js";
import { createMcpExpressApp, requireBearerAuth } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { usersRouter } from "./users.js";

const TTL_MS = 30 * 60_000;
const handles = new Map<string, { owner: string; handle: BookingHandle; expires: number }>();

function saveHandle(prefix: "flt" | "htl", owner: string, handle: BookingHandle | null) {
  if (!handle) {
    return null;
  }
  const ref = `${prefix}_${handles.size}`;
  handles.set(ref, { owner, handle, expires: Date.now() + TTL_MS });
  return ref;
}

function getHandle(ref: string, userId: string) {
  const entry = handles.get(ref);
  if (!entry || entry.owner != userId || entry.expires < Date.now()) return null;
  return entry.handle;
}

function textResult(text: string): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: text,
      },
    ],
  };
}

function errorResult(text: string): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: text,
      },
    ],
    isError: true,
  };
}

export function filterFlights(
  parsedData: z.infer<typeof FlightSchema>,
  numberOfFlights: number,
  owner: string,
) {
  const itineraries = parsedData.data.itineraries;
  const flights = itineraries.topFlights?.length
    ? itineraries.topFlights
    : itineraries.otherFlights?.length
      ? itineraries.otherFlights
      : [];
  const filteredResult = flights.slice(0, numberOfFlights).map((flight) => {
    const handle = flight.next_token
      ? { kind: "next" as const, token: flight.next_token }
      : flight.booking_token
        ? {
            kind: "booking" as const,
            token: flight.booking_token,
          }
        : null;
    const flightRef = saveHandle("flt", owner, handle);
    return {
      departureTime: flight.departure_time,
      arrivalTime: flight.arrival_time,
      duration: flight.duration,
      roundTripPrice: flight.price,
      segments: flight.flights.map((leg) => ({
        departure: leg.departure_airport,
        arrival: leg.arrival_airport,
        duration: leg.duration,
      })),
      layovers: flight.layovers,
      ref: flightRef,
    };
  });
  return filteredResult;
}

function createServer(ctx: McpRequestContext) {
  const userId = ctx.authInfo?.extra?.userId as string | undefined;
  const owner = userId ?? "anon";
  const server = new McpServer({
    name: "mcp-travel-agent-port",
    version: "1.0.0",
  });

  // --- Tools -----------------------------------------------------------------

  server.registerTool(
    "get_lat_lon",
    {
      title: "Get Lat Lon",
      description: "Return the latitude and longitude of a city",
      inputSchema: z.object({
        city: z.string().describe("The name of the city to search for. "),
        countryCode: z.string().nullable().describe("ISO country code. e.g. GB"),
      }),
    },
    async ({ city, countryCode }) => {
      const query = countryCode ? city + "," + countryCode : city;
      const baseURL = "https://api.openweathermap.org/geo/1.0/direct";
      const fullURL = constructUrl(baseURL, { q: query, appid: WEATHER_API_KEY });
      const latLonData = await fetchAPI(fullURL);
      const parseResult = parseData(LatLonSchema, latLonData);
      return textResult(JSON.stringify(parseResult));
    },
  );

  server.registerTool(
    "get_weather",
    {
      title: "Get weather",
      description: "Return the weather for a given location.",

      inputSchema: z.object({
        lat: z.number().describe("The latitude of the city"),
        lon: z.number().describe("The longitude of the city"),
        unit: z
          .string()
          .nullable()
          .describe(
            "Unit of measurement. 'metric' and 'imperial' units are available. Defaults to 'metric'.",
          ),
      }),
    },
    async ({ lat, lon, unit }) => {
      const unitCleaned = unit == "imperial" ? "imperial" : "metric";
      const baseURL = "https://api.openweathermap.org/data/2.5/weather";
      const options = {
        lat,
        lon,
        appid: WEATHER_API_KEY,
        units: unitCleaned,
      };
      const fullUrl = constructUrl(baseURL, options);
      const data = await fetchAPI(fullUrl);
      const parsedData = parseData(WeatherSchema, data);
      const filteredResult = {
        weather: parsedData.weather[0].main,
        weatherDescription: parsedData.weather[0].description,
        temp: parsedData.main.temp,
      };
      return textResult(JSON.stringify(filteredResult));
    },
  );

  server.registerTool(
    "get_flights",
    {
      title: "Get Flights",
      description:
        "Return the outbound flight form a city to another city on the given date. The returned data will include a ref like 'flt_0'. Call get_next_flights to obtain the returning flight. If a ref is missing, do not call get_next_flights. Note that the price is the estimated amount for a full round trip.",
      inputSchema: getFlightsParams,
    },
    async ({ departure, arrival, departureDate, returningDate, personCount, currency }) => {
      const baseURL = "https://google-flights2.p.rapidapi.com/api/v1/searchFlights";
      const options = {
        departure_id: departure,
        arrival_id: arrival,
        outbound_date: departureDate,
        return_date: returningDate,
        adults: personCount,
        currency: currency ?? "USD",
      };
      const url = constructUrl(baseURL, options);

      const response = await fetchRapidAPI(url, "google-flights2.p.rapidapi.com");
      // const response = SAMPLE_NEXT_TOKEN_FLIGHT;
      // const response = SAMPLE_FLIGHT_DATA;

      const parsedData = parseData(FlightSchema, response);
      const filteredFlights = filterFlights(parsedData, 3, owner);

      if (filteredFlights.length === 0) {
        return errorResult("Failed to fetch requested information. Please try again later.");
      }

      return textResult(JSON.stringify(filteredFlights));
    },
  );

  server.registerTool(
    "get_next_flights",
    {
      title: "Get Next Flights",
      description:
        "Returns the returning set of a flight based on the outbound flight from a previous search. Used to retrieve returning flight of a round-trip flight. Note that the price is the accurate amount for the full round trip.",
      inputSchema: getNextFlightParams,
    },
    async ({ ref, currency }) => {
      const handle = getHandle(ref, owner);
      if (!handle) {
        return errorResult(`Unknown ref ${ref}. Please select a different flight.`);
      }
      if (handle.kind != "next") {
        return errorResult(
          `${ref} is not a outbound flight. Please use an entry from the result of get_flights tool.`,
        );
      }
      const baseURL = "https://google-flights2.p.rapidapi.com/api/v1/getNextFlights";
      const options = {
        next_token: handle.token,
        currency: currency ?? "USD",
      };

      const url = constructUrl(baseURL, options);

      const response = await fetchRapidAPI(url, "google-flights2.p.rapidapi.com", 60_000);
      // const response = SAMPLE_BOOK_TOKEN_FLIGHT;

      const parsedData = parseData(FlightSchema, response);

      const filteredFlights = filterFlights(parsedData, 3, owner);

      if (filteredFlights.length === 0) {
        return errorResult("Failed to fetch requested information. Please try again later.");
      }

      return textResult(JSON.stringify(filteredFlights));
    },
  );

  server.registerTool(
    "get_hotels",
    {
      title: "Get Hotels",
      description:
        "Return up to 5 accommodations near a location. price is the all-inclusive total for the whole stay, not per night. Each result includes a ref like 'htl_3'; mention the chosen hotel's ref in your plan.",
      inputSchema: getHotelsParams,
    },
    async ({ lat, lon, person, checkInDate, checkOutDate, currencyCode }) => {
      const options = {
        latitude: lat,
        longitude: lon,
        arrival_date: checkInDate,
        departure_date: checkOutDate,
        adults: person,
        currency_code: currencyCode ?? "USD",
        radius: 20,
      };
      const baseURL =
        "https://booking-com15.p.rapidapi.com/api/v1/hotels/searchHotelsByCoordinates";
      const url = constructUrl(baseURL, options);
      const host = "booking-com15.p.rapidapi.com";

      const result = await fetchRapidAPI(url, host);
      const parsedData = parseData(HotelsSchema, result);
      const filteredResult = parsedData.data.result.slice(0, 5).map((hotel) => {
        const handle: HotelHandle = {
          kind: "hotel",
          token: String(hotel.hotel_id),
          checkIn: checkInDate,
          checkOut: checkOutDate,
          adults: person,
        };
        const ref = saveHandle("htl", owner, handle);
        return {
          name: hotel.hotel_name, //"Cordis, Beijing Capital Airport By Langham Hospitality Group"
          translatedName: hotel.hotel_name_trans, //"Cordis, Beijing Capital Airport By Langham Hospitality Group"
          checkInTime: hotel.checkin, //          until: "23:30",from: "14:00",
          checkOutTime: hotel.checkout, //          {from: "01:00",          until: "12:00",}
          reviewScore: hotel.review_score, //8.7
          reviewCount: hotel.review_nr, //1830
          star: hotel.class, //5
          price: hotel.composite_price_breakdown.all_inclusive_amount, //{value: 3352.39818467217, currency: "USD"}
          ref: ref,
        };
      });

      return textResult(JSON.stringify(filteredResult));
    },
  );

  server.registerTool(
    "get_attractions",
    {
      title: "Get Attractions",
      description: "Return a list of tourist attractions for a given location. ",

      inputSchema: z.object({
        lat: z.number().describe("The latitude of the city"),
        lon: z.number().describe("The longitude of the city"),
      }),
    },
    async ({ lat, lon }) => {
      const baseURL = "https://api.geoapify.com/v2/places";
      const options = {
        categories: `heritage,national_park,tourism.sights,entertainment.museum,entertainment.zoo,entertainment.aquarium`,
        filter: `circle:${lon},${lat},10000`,
        conditions: "named",
        limit: 10,
        apiKey: GEOAPIFY_KEY,
      };
      const url = constructUrl(baseURL, options);
      const host = "booking-com15.p.rapidapi.com";

      const result = await fetchRapidAPI(url, host);
      const parsedData = parseData(PlacesSchema, result);
      const filteredResult = parsedData.features.map((place) => ({
        name: place.properties.name_international?.en || place.properties.name,
        website: place.properties.website,
        openingHours: place.properties.opening_hours,
        categories: place.properties.categories,
        wikipedia: place.properties.wiki_and_media?.wikipedia,
      }));

      return textResult(JSON.stringify(filteredResult.slice(0, 10)));
    },
  );

  // --- Resources -------------------------------------------------------------

  server.registerResource(
    "destination",
    new ResourceTemplate("travel://destinations/{city}", { list: undefined }),
    {
      title: "Destination info",
      description: "Basic placeholder information about a destination city",
    },
    async (uri, { city }) => ({
      contents: [
        {
          uri: uri.href,
          text: `Destination: ${city}\n(Placeholder data — wire up a real data source here.)`,
        },
      ],
    }),
  );

  server.registerResource(
    "user_profile",
    "travel://me/profiles",
    {
      title: "User profile",
      description:
        "Returns information about the current logged in user. Returns a plain sentence if the user is not logged in.",
    },
    async (uri) => {
      if (!userId) {
        return {
          contents: [
            {
              uri: uri.href,
              text: "User is not logged in.",
            },
          ],
        };
      }
      const result = await fetch(`http://localhost:3000/api/users/${userId}`);
      const response = await result.json();
      const user = parseData(UserSchema, response);
      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify(user),
          },
        ],
      };
    },
  );

  // --- Prompts ---------------------------------------------------------------

  server.registerPrompt(
    "plan_trip",
    {
      title: "Plan a trip",
      description: "Asks the model to draft a short itinerary",
      argsSchema: z.object({
        destination: z.string(),
        startDate: z.string(),
        endDate: z.string(),
        budget: z.coerce.number().describe("Budget in USD"),
      }),
    },
    ({ destination, startDate, endDate, budget }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `System Prompt: You are a helpful travel planner. You will plan the user's trip in plain text format. You response will include "events", which include weather, transportation, accommodations, and tourist activities. Separate them out into text blocks. User Prompt: The user is planning a trip to ${destination} on ${startDate}. They plan to return on ${endDate}. Their budget is ${budget}`,
          },
        },
      ],
    }),
  );
  return server;
}

// --- Fake Auth --------------------------------------------------------------

// const devTokens: Record<string, string> = { "dev-u1": "u1", "dev-u2": "u2" };

// const verifier: OAuthTokenVerifier = {
//   async verifyAccessToken(token) {
//     const userId = devTokens[token];
//     if (!userId) throw new OAuthError(OAuthErrorCode.InvalidToken, "Unknown token");
//     return {
//       token,
//       clientId: "dev",
//       scopes: [],
//       expiresAt: Math.floor(Date.now() / 1000) + 3600, // required, or the token is rejected
//       extra: { userId },
//     };
//   },
// };

// --- Start -----------------------------------------------------------------

const app = createMcpExpressApp();
const handler = toNodeHandler(createMcpHandler((ctx) => createServer(ctx)));

app.all("/mcp", (req, res) => handler(req, res, req.body));
app.use("/api/users", usersRouter);

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, "127.0.0.1", () => {
  console.log(`Weather MCP server listening on http://localhost:${PORT}/mcp`);
});

console.error("mcp-travel-agent-port running on http");
